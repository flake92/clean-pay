$ErrorActionPreference = 'Stop'

$repo = 'C:\code\remnashop-pr'

function Write-TextFile {
    param(
        [Parameter(Mandatory=$true)][string]$Path,
        [Parameter(Mandatory=$true)][string]$Content
    )
    $directory = Split-Path -Parent $Path
    if ($directory -and -not (Test-Path -LiteralPath $directory)) {
        New-Item -ItemType Directory -Path $directory | Out-Null
    }
    Set-Content -LiteralPath $Path -Value $Content -Encoding UTF8
}

Write-TextFile -Path "$repo\src\infrastructure\database\models\user_merge_audit.py" -Content @'
from typing import Optional

from sqlalchemy import Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import BaseSql
from .timestamp import TimestampMixin


class UserMergeAudit(BaseSql, TimestampMixin):
    __tablename__ = "user_merge_audit"

    id: Mapped[int] = mapped_column(primary_key=True)
    actor_user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    actor_role: Mapped[str] = mapped_column(String(32), nullable=False)
    source_user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    target_user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    reason: Mapped[str] = mapped_column(String(1024), nullable=False)
    dry_run: Mapped[bool] = mapped_column(nullable=False, default=False)
    moved: Mapped[dict[str, int]] = mapped_column(JSONB, nullable=False)
    conflicts: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
'@

Write-TextFile -Path "$repo\src\application\use_cases\user\commands\merge.py" -Content @'
from dataclasses import dataclass, field
from datetime import timezone

from sqlalchemy import delete, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.application.common import Interactor
from src.application.common.policy import Permission
from src.application.common.uow import UnitOfWork
from src.application.dto import UserDto
from src.core.enums import AuthType
from src.core.utils.time import datetime_now
from src.infrastructure.database.models import (
    Referral,
    ReferralReward,
    Subscription,
    Transaction,
    User,
    UserMergeAudit,
    UserOAuthProvider,
)


class MergeUsersError(Exception):
    status_code = 400


class MergeUsersNotFoundError(MergeUsersError):
    status_code = 404


class MergeUsersConflictError(MergeUsersError):
    status_code = 409


@dataclass(frozen=True)
class MergeUsersDto:
    source_user_id: int
    target_user_id: int
    reason: str
    dry_run: bool = False


@dataclass(frozen=True)
class MergeUsersTargetDto:
    id: int
    email: str | None
    telegram_id: int | None
    is_email_verified: bool
    current_subscription_id: int | None


@dataclass(frozen=True)
class MergeUsersResultDto:
    dry_run: bool
    source_user_id: int
    target_user_id: int
    target: MergeUsersTargetDto
    moved: dict[str, int]
    conflicts: list[str] = field(default_factory=list)
    requires_relogin: bool = True


def _rowcount(result: object) -> int:
    return int(getattr(result, "rowcount", 0) or 0)


class MergeUsers(Interactor[MergeUsersDto, MergeUsersResultDto]):
    required_permission = Permission.USER_MERGE

    def __init__(self, uow: UnitOfWork, session: AsyncSession) -> None:
        self.uow = uow
        self.session = session

    async def _execute(self, actor: UserDto, data: MergeUsersDto) -> MergeUsersResultDto:
        reason = data.reason.strip()
        if not reason:
            raise MergeUsersConflictError("Merge reason is required")
        if data.source_user_id == data.target_user_id:
            raise MergeUsersConflictError("Source and target users must be different")

        async with self.uow:
            source, target = await self._lock_users(data.source_user_id, data.target_user_id)
            conflicts = self._validate(source, target)
            moved = await self._collect_moved_counts(source.id, target.id)

            if data.dry_run:
                result = self._result(data, target, moved, conflicts)
                await self.session.rollback()
                return result

            if conflicts:
                raise MergeUsersConflictError("; ".join(conflicts))

            await self._merge(source, target, moved)
            self.session.add(
                UserMergeAudit(
                    actor_user_id=None if actor.id < 0 else actor.id,
                    actor_role=actor.role.name,
                    source_user_id=source.id,
                    target_user_id=target.id,
                    reason=reason,
                    dry_run=False,
                    moved=moved,
                    conflicts=[],
                )
            )
            await self.uow.commit()
            return self._result(data, target, moved, [])

    async def _lock_users(self, source_user_id: int, target_user_id: int) -> tuple[User, User]:
        ordered_ids = sorted([source_user_id, target_user_id])
        stmt = select(User).where(User.id.in_(ordered_ids)).order_by(User.id).with_for_update()
        users = list((await self.session.scalars(stmt)).all())
        by_id = {user.id: user for user in users}
        source = by_id.get(source_user_id)
        target = by_id.get(target_user_id)
        if source is None:
            raise MergeUsersNotFoundError(f"Source user '{source_user_id}' not found")
        if target is None:
            raise MergeUsersNotFoundError(f"Target user '{target_user_id}' not found")
        return source, target

    def _validate(self, source: User, target: User) -> list[str]:
        conflicts: list[str] = []
        if not source.email:
            conflicts.append("Source user has no email")
        if not source.is_email_verified:
            conflicts.append("Source user email is not verified")
        if target.telegram_id is None:
            conflicts.append("Target user has no Telegram account")
        if source.telegram_id is not None and source.telegram_id != target.telegram_id:
            conflicts.append("Source user is linked to a different Telegram account")
        if target.email and source.email and target.email != source.email:
            conflicts.append("Target user already has a different email")
        return conflicts

    async def _collect_moved_counts(self, source_user_id: int, target_user_id: int) -> dict[str, int]:
        return {
            "subscriptions": await self._count(Subscription.user_id == source_user_id),
            "transactions": await self._count(Transaction.user_id == source_user_id),
            "referrals_as_referrer": await self._count(Referral.referrer_id == source_user_id),
            "referrals_as_referred": await self._count(Referral.referred_id == source_user_id),
            "referral_rewards": await self._count(ReferralReward.user_id == source_user_id),
            "promocode_activations": await self._count_promocode_activations(source_user_id),
            "promocode_activation_duplicates": await self._count_promocode_duplicates(
                source_user_id, target_user_id
            ),
            "oauth_providers": await self._count(UserOAuthProvider.user_id == source_user_id),
            "oauth_provider_duplicates": await self._count_oauth_duplicates(
                source_user_id, target_user_id
            ),
        }

    async def _count(self, *where: object) -> int:
        model = where[0].left.class_  # type: ignore[attr-defined]
        stmt = select(func.count()).select_from(model).where(*where)
        return int(await self.session.scalar(stmt) or 0)

    async def _count_promocode_activations(self, source_user_id: int) -> int:
        stmt = text("select count(*) from promocode_activations where user_id = :source_user_id")
        return int(await self.session.scalar(stmt, {"source_user_id": source_user_id}) or 0)

    async def _count_promocode_duplicates(self, source_user_id: int, target_user_id: int) -> int:
        stmt = text(
            """
            select count(*)
            from promocode_activations source
            join promocode_activations target
              on target.promocode_id = source.promocode_id
             and target.user_id = :target_user_id
            where source.user_id = :source_user_id
            """
        )
        params = {"source_user_id": source_user_id, "target_user_id": target_user_id}
        return int(await self.session.scalar(stmt, params) or 0)

    async def _count_oauth_duplicates(self, source_user_id: int, target_user_id: int) -> int:
        stmt = text(
            """
            select count(*)
            from user_oauth_providers source
            join user_oauth_providers target
              on target.provider = source.provider
             and target.user_id = :target_user_id
            where source.user_id = :source_user_id
            """
        )
        params = {"source_user_id": source_user_id, "target_user_id": target_user_id}
        return int(await self.session.scalar(stmt, params) or 0)

    async def _merge(self, source: User, target: User, moved: dict[str, int]) -> None:
        source_email = source.email
        source_password_hash = source.password_hash
        source_subscription_id = source.current_subscription_id
        target_subscription_id = target.current_subscription_id or source_subscription_id

        source.email = None
        source.pending_email = None
        source.email_verification_code_hash = None
        source.email_verification_expires_at = None
        source.password_reset_code_hash = None
        source.password_reset_expires_at = None
        source.password_hash = None
        source.is_email_verified = False
        source.telegram_id = None
        source.current_subscription_id = None
        source.token_version += 1
        source.is_blocked = True
        source.merged_into_user_id = target.id
        source.merged_at = datetime_now().astimezone(timezone.utc)
        await self.session.flush()

        await self._move_simple_fk(Subscription, source.id, target.id)
        await self._move_simple_fk(Transaction, source.id, target.id)
        await self._move_referrals(source.id, target.id, moved)
        await self._move_promocode_activations(source.id, target.id)
        await self._move_oauth_providers(source.id, target.id)

        target.email = source_email
        target.password_hash = source_password_hash
        target.is_email_verified = True
        target.pending_email = None
        target.email_verification_code_hash = None
        target.email_verification_expires_at = None
        target.password_reset_code_hash = None
        target.password_reset_expires_at = None
        target.current_subscription_id = target_subscription_id
        target.auth_type = AuthType.EMAIL
        target.token_version += 1
        await self.session.flush()

    async def _move_simple_fk(self, model: type[object], source_user_id: int, target_user_id: int) -> int:
        stmt = update(model).where(model.user_id == source_user_id).values(user_id=target_user_id)
        return _rowcount(await self.session.execute(stmt))

    async def _move_referrals(
        self, source_user_id: int, target_user_id: int, moved: dict[str, int]
    ) -> None:
        target_is_referred = bool(
            await self.session.scalar(
                select(Referral.id).where(Referral.referred_id == target_user_id).limit(1)
            )
        )
        if target_is_referred:
            deleted = await self.session.execute(
                delete(Referral).where(Referral.referred_id == source_user_id)
            )
            moved["referrals_as_referred_dropped"] = _rowcount(deleted)
        else:
            await self.session.execute(
                update(Referral)
                .where(Referral.referred_id == source_user_id)
                .values(referred_id=target_user_id)
            )

        await self.session.execute(
            delete(Referral).where(
                Referral.referrer_id == source_user_id,
                Referral.referred_id == target_user_id,
            )
        )
        await self.session.execute(
            update(Referral)
            .where(Referral.referrer_id == source_user_id)
            .values(referrer_id=target_user_id)
        )
        await self.session.execute(
            delete(Referral).where(Referral.referrer_id == Referral.referred_id)
        )
        await self.session.execute(
            update(ReferralReward)
            .where(ReferralReward.user_id == source_user_id)
            .values(user_id=target_user_id)
        )

    async def _move_promocode_activations(self, source_user_id: int, target_user_id: int) -> None:
        await self.session.execute(
            text(
                """
                delete from promocode_activations source
                using promocode_activations target
                where source.user_id = :source_user_id
                  and target.user_id = :target_user_id
                  and source.promocode_id = target.promocode_id
                """
            ),
            {"source_user_id": source_user_id, "target_user_id": target_user_id},
        )
        await self.session.execute(
            text(
                """
                update promocode_activations
                   set user_id = :target_user_id
                 where user_id = :source_user_id
                """
            ),
            {"source_user_id": source_user_id, "target_user_id": target_user_id},
        )

    async def _move_oauth_providers(self, source_user_id: int, target_user_id: int) -> None:
        await self.session.execute(
            text(
                """
                delete from user_oauth_providers source
                using user_oauth_providers target
                where source.user_id = :source_user_id
                  and target.user_id = :target_user_id
                  and source.provider = target.provider
                """
            ),
            {"source_user_id": source_user_id, "target_user_id": target_user_id},
        )
        await self.session.execute(
            update(UserOAuthProvider)
            .where(UserOAuthProvider.user_id == source_user_id)
            .values(user_id=target_user_id)
        )

    def _result(
        self,
        data: MergeUsersDto,
        target: User,
        moved: dict[str, int],
        conflicts: list[str],
    ) -> MergeUsersResultDto:
        return MergeUsersResultDto(
            dry_run=data.dry_run,
            source_user_id=data.source_user_id,
            target_user_id=data.target_user_id,
            target=MergeUsersTargetDto(
                id=target.id,
                email=target.email,
                telegram_id=target.telegram_id,
                is_email_verified=target.is_email_verified,
                current_subscription_id=target.current_subscription_id,
            ),
            moved=moved,
            conflicts=conflicts,
        )
'@

Write-TextFile -Path "$repo\src\web\schemas\admin.py" -Content @'
from pydantic import BaseModel, ConfigDict, Field


class MergeUsersRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    source_user_id: int = Field(gt=0)
    target_user_id: int = Field(gt=0)
    reason: str = Field(min_length=1, max_length=1024)


class MergeUsersTargetResponse(BaseModel):
    id: int
    email: str | None
    telegram_id: int | None
    is_email_verified: bool
    current_subscription_id: int | None


class MergeUsersResponse(BaseModel):
    dry_run: bool
    source_user_id: int
    target_user_id: int
    target: MergeUsersTargetResponse
    moved: dict[str, int]
    conflicts: list[str]
    requires_relogin: bool
'@

Write-TextFile -Path "$repo\src\web\endpoints\admin\__init__.py" -Content @'
from fastapi import APIRouter

from src.core.constants import API_V1

from .users import router as users_router

router = APIRouter(prefix=API_V1 + "/admin")
router.include_router(users_router)

__all__ = ["router"]
'@

Write-TextFile -Path "$repo\src\web\endpoints\admin\users.py" -Content @'
from dishka import FromDishka
from dishka.integrations.fastapi import inject
from fastapi import APIRouter, HTTPException, Security

from src.application.use_cases.user.commands.merge import (
    MergeUsers,
    MergeUsersConflictError,
    MergeUsersDto,
    MergeUsersError,
    MergeUsersNotFoundError,
)
from src.web.dependencies import require_api_key
from src.web.schemas import MergeUsersRequest, MergeUsersResponse

router = APIRouter(prefix="/users", tags=["Admin - Users"])


@router.post("/merge", response_model=MergeUsersResponse)
@inject
async def merge_users(
    body: MergeUsersRequest,
    merge_users_uc: FromDishka[MergeUsers],
    dry_run: bool = True,
    _: None = Security(require_api_key),
) -> MergeUsersResponse:
    try:
        result = await merge_users_uc.system(
            MergeUsersDto(
                source_user_id=body.source_user_id,
                target_user_id=body.target_user_id,
                reason=body.reason,
                dry_run=dry_run,
            )
        )
    except (MergeUsersConflictError, MergeUsersNotFoundError) as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except MergeUsersError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    return MergeUsersResponse(
        dry_run=result.dry_run,
        source_user_id=result.source_user_id,
        target_user_id=result.target_user_id,
        target=result.target,
        moved=result.moved,
        conflicts=result.conflicts,
        requires_relogin=result.requires_relogin,
    )
'@

Write-TextFile -Path "$repo\src\infrastructure\database\migrations\versions\0042_add_user_merge_audit.py" -Content @'
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0042"
down_revision: Union[str, None] = "0041"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("merged_into_user_id", sa.Integer(), nullable=True))
    op.add_column("users", sa.Column("merged_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index(
        "ix_users_merged_into_user_id",
        "users",
        ["merged_into_user_id"],
        unique=False,
    )
    op.create_foreign_key(
        "fk_users_merged_into_user_id_users",
        "users",
        "users",
        ["merged_into_user_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.create_table(
        "user_merge_audit",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("actor_role", sa.String(length=32), nullable=False),
        sa.Column("source_user_id", sa.Integer(), nullable=False),
        sa.Column("target_user_id", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(length=1024), nullable=False),
        sa.Column("dry_run", sa.Boolean(), nullable=False),
        sa.Column("moved", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("conflicts", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("timezone('UTC', now())"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("timezone('UTC', now())"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_user_merge_audit_actor_user_id",
        "user_merge_audit",
        ["actor_user_id"],
        unique=False,
    )
    op.create_index(
        "ix_user_merge_audit_source_user_id",
        "user_merge_audit",
        ["source_user_id"],
        unique=False,
    )
    op.create_index(
        "ix_user_merge_audit_target_user_id",
        "user_merge_audit",
        ["target_user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_user_merge_audit_target_user_id", table_name="user_merge_audit")
    op.drop_index("ix_user_merge_audit_source_user_id", table_name="user_merge_audit")
    op.drop_index("ix_user_merge_audit_actor_user_id", table_name="user_merge_audit")
    op.drop_table("user_merge_audit")
    op.drop_constraint("fk_users_merged_into_user_id_users", "users", type_="foreignkey")
    op.drop_index("ix_users_merged_into_user_id", table_name="users")
    op.drop_column("users", "merged_at")
    op.drop_column("users", "merged_into_user_id")
'@

$userModel = Get-Content -LiteralPath "$repo\src\infrastructure\database\models\user.py" -Raw
$userModel = $userModel -replace 'from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String', 'from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String'
$userModel = $userModel -replace '    current_subscription_id: Mapped\[Optional\[int\]\] = mapped_column\(\r?\n        ForeignKey\("subscriptions.id", ondelete="SET NULL"\),\r?\n        index=True,\r?\n    \)\r?\n', @'
    current_subscription_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("subscriptions.id", ondelete="SET NULL"),
        index=True,
    )

    merged_into_user_id: Mapped[Optional[int]] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    merged_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
'@
Set-Content -LiteralPath "$repo\src\infrastructure\database\models\user.py" -Value $userModel -Encoding UTF8

$modelsInit = Get-Content -LiteralPath "$repo\src\infrastructure\database\models\__init__.py" -Raw
$modelsInit = $modelsInit -replace 'from \.transaction import Transaction\r?\nfrom \.user import User', "from .transaction import Transaction`r`nfrom .user import User`r`nfrom .user_merge_audit import UserMergeAudit"
$modelsInit = $modelsInit -replace '    "Transaction",\r?\n    "User",', "    `"Transaction`",`r`n    `"User`",`r`n    `"UserMergeAudit`","
Set-Content -LiteralPath "$repo\src\infrastructure\database\models\__init__.py" -Value $modelsInit -Encoding UTF8

$policy = Get-Content -LiteralPath "$repo\src\application\common\policy.py" -Raw
$policy = $policy -replace '    USER_SYNC = auto\(\)', "    USER_SYNC = auto()`r`n    USER_MERGE = auto()"
Set-Content -LiteralPath "$repo\src\application\common\policy.py" -Value $policy -Encoding UTF8

$userUseCases = Get-Content -LiteralPath "$repo\src\application\use_cases\user\__init__.py" -Raw
$userUseCases = $userUseCases -replace 'from \.commands\.messaging import SendMessageToUser', "from .commands.merge import MergeUsers`r`nfrom .commands.messaging import SendMessageToUser"
$userUseCases = $userUseCases -replace '    SendMessageToUser,\r?\n', "    SendMessageToUser,`r`n    MergeUsers,`r`n"
Set-Content -LiteralPath "$repo\src\application\use_cases\user\__init__.py" -Value $userUseCases -Encoding UTF8

$schemasInit = Get-Content -LiteralPath "$repo\src\web\schemas\__init__.py" -Raw
$schemasInit = $schemasInit -replace 'from \.auth import \(', "from .admin import MergeUsersRequest, MergeUsersResponse, MergeUsersTargetResponse`r`nfrom .auth import ("
$schemasInit = $schemasInit -replace '    # health\r?\n', "    # admin`r`n    `"MergeUsersRequest`",`r`n    `"MergeUsersResponse`",`r`n    `"MergeUsersTargetResponse`",`r`n    # health`r`n"
Set-Content -LiteralPath "$repo\src\web\schemas\__init__.py" -Value $schemasInit -Encoding UTF8

$endpointsInit = Get-Content -LiteralPath "$repo\src\web\endpoints\__init__.py" -Raw
$endpointsInit = $endpointsInit -replace 'from \.health import router as health_router', "from .admin import router as admin_router`r`nfrom .health import router as health_router"
$endpointsInit = $endpointsInit -replace '__all__ = \[\r?\n', "__all__ = [`r`n    `"admin_router`",`r`n"
Set-Content -LiteralPath "$repo\src\web\endpoints\__init__.py" -Value $endpointsInit -Encoding UTF8

$app = Get-Content -LiteralPath "$repo\src\web\app.py" -Raw
$app = $app -replace 'from \.endpoints import \(\r?\n', "from .endpoints import (`r`n    admin_router,`r`n"
$app = $app -replace '    if config.web_enabled:\r?\n        app.include_router\(public_router\)', "    if config.web_enabled:`r`n        app.include_router(public_router)`r`n        app.include_router(admin_router)"
Set-Content -LiteralPath "$repo\src\web\app.py" -Value $app -Encoding UTF8

