from collections.abc import AsyncIterable
import os

from aiogram import Bot
from aiogram.client.default import DefaultBotProperties
from aiogram.client.session.aiohttp import AiohttpSession
from aiogram.client.telegram import TelegramAPIServer
from aiogram.enums import ParseMode
from aiogram_dialog import BgManagerFactory
from dishka import Provider, Scope, from_context, provide
from loguru import logger

from src.core.config import AppConfig


def _normalize_proxy_url(url: str) -> str:
    if url.startswith("socks5h://"):
        return url.replace("socks5h://", "socks5://", 1)
    if url.startswith("socks4a://"):
        return url.replace("socks4a://", "socks4://", 1)
    return url


class BotProvider(Provider):
    scope = Scope.APP

    bg_manager_factory = from_context(provides=BgManagerFactory)

    @provide
    async def get_bot(self, config: AppConfig) -> AsyncIterable[Bot]:
        logger.debug("Initializing Bot instance")

        session = None
        bot_api_base_url = os.environ.get("BOT_API_BASE_URL")
        if bot_api_base_url:
            logger.info(f"Using custom Telegram Bot API base URL: {bot_api_base_url}")
            session = AiohttpSession(
                api=TelegramAPIServer.from_base(bot_api_base_url),
            )
        elif config.bot.proxy_url:
            logger.info("Using SOCKS5 proxy for Telegram")
            proxy = _normalize_proxy_url(config.bot.proxy_url.get_secret_value())
            session = AiohttpSession(proxy=proxy)

        async with Bot(
            token=config.bot.token.get_secret_value(),
            default=DefaultBotProperties(parse_mode=ParseMode.HTML),
            session=session,
        ) as bot:
            yield bot
