import { globSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import {
  transactionConcurrencyViolations,
  type TransactionSourceFile,
} from "./transaction-concurrency-analyzer";

function inlineSource(sourceText: string): TransactionSourceFile[] {
  return [{ file: "tests/fixtures/transaction-inline.ts", sourceText }];
}

describe("production incident regressions", () => {
  it("detects concurrent work on one interactive Prisma transaction connection", () => {
    expect(transactionConcurrencyViolations(inlineSource(`
      prisma.$transaction(async (tx) => {
        await Promise.all([
          tx.webUser.findUnique({ where: { id: "one" } }),
          lookupOwner(tx),
        ]);
      });
    `))).toEqual([
      expect.objectContaining({
        line: 3,
        combinator: "Promise.all",
        transactionClient: "tx",
      }),
    ]);
  });

  it("follows transaction aliases into helpers in this file", () => {
    const violations = transactionConcurrencyViolations(inlineSource(`
      async function reconcileRemnashopUser(client: Prisma.TransactionClient) {
        const database = client;
        const [linkedById, linkedByEmail, linkedByTelegram] = await Promise.all([
          database.webUser.findUnique({ where: { remnashopUserId: "one" } }),
          database.webUser.findUnique({ where: { email: "one@example.com" } }),
          database.webUser.findUnique({ where: { telegramId: "one" } }),
        ]);
        return linkedById ?? linkedByEmail ?? linkedByTelegram;
      }

      const runTransaction = prisma.$transaction.bind(prisma);
      await runTransaction(async (tx) => reconcileRemnashopUser(tx));
    `));

    expect(violations).toEqual([
      expect.objectContaining({
        line: 4,
        combinator: "Promise.all",
        transactionClient: "client",
      }),
    ]);
  });

  it("resolves named callbacks, nullish aliases, and staged query promises", () => {
    const violations = transactionConcurrencyViolations(inlineSource(`
      async function loadOwners(client: Prisma.TransactionClient) {
        const database = client ?? fallbackClient;
        const first = database.webUser.findUnique({ where: { id: "one" } });
        const second = database.webUser.findUnique({ where: { id: "two" } });
        const { all: together } = Promise;
        return together([first, second]);
      }

      async function work(transaction: Prisma.TransactionClient) {
        return loadOwners(transaction);
      }

      const runTransaction = prisma.$transaction.bind(prisma);
      await runTransaction(work);
    `));

    expect(violations).toEqual([
      expect.objectContaining({
        line: 7,
        combinator: "Promise.all",
        transactionClient: "client",
      }),
    ]);
  });

  it("follows aliased imported helpers that receive the transaction client", () => {
    const violations = transactionConcurrencyViolations([
      {
        file: "tests/fixtures/transaction-entry.ts",
        sourceText: `
          import { assertUserMergeFinalOwner as assertOwner } from "./transaction-helper";

          prisma.$transaction(async (tx) => {
            const database = tx;
            await assertOwner(database);
          });
        `,
      },
      {
        file: "tests/fixtures/transaction-helper.ts",
        sourceText: `
          export async function assertUserMergeFinalOwner(tx: Prisma.TransactionClient) {
            const [target, remainingSourceCount] = await Promise.all([
              tx.webUser.findUnique({ where: { id: "target" } }),
              tx.webUser.count({ where: { id: { in: ["source"] } } }),
            ]);
            return { target, remainingSourceCount };
          }
        `,
      },
    ]);

    expect(violations).toEqual([
      expect.objectContaining({
        file: "tests/fixtures/transaction-helper.ts",
        line: 3,
        combinator: "Promise.all",
        transactionClient: "tx",
      }),
    ]);
  });

  it("detects transaction queries produced by mapped iterable aliases", () => {
    const violations = transactionConcurrencyViolations(inlineSource(`
      prisma.$transaction(async (tx) => {
        const mappedQueries = userIds.map((id) =>
          tx.webUser.findUnique({ where: { id } }));
        await Promise.all(mappedQueries);

        const flattenedQueries = userIds.flatMap((id) => [
          tx.webUser.findUnique({ where: { id } }),
        ]);
        await Promise.all(flattenedQueries);

        const copiedQueries = Array.from(userIds, (id) =>
          tx.webUser.findUnique({ where: { id } }));
        await Promise.all(copiedQueries);
      });
    `));

    expect(violations).toEqual([
      expect.objectContaining({ line: 5, combinator: "Promise.all" }),
      expect.objectContaining({ line: 10, combinator: "Promise.all" }),
      expect.objectContaining({ line: 14, combinator: "Promise.all" }),
    ]);
  });

  it("looks through filtered arrays, object values, and pushed query jobs", () => {
    const violations = transactionConcurrencyViolations(inlineSource(`
      prisma.$transaction(async (tx) => {
        let database: Prisma.TransactionClient;
        database = tx;
        await Promise.all([
          database.webUser.findUnique({ where: { id: "one" } }),
          database.webUser.findUnique({ where: { id: "two" } }),
        ].filter(Boolean));

        await Promise.all(Object.values({
          first: database.webUser.findUnique({ where: { id: "one" } }),
          second: database.webUser.findUnique({ where: { id: "two" } }),
        }));

        const jobs = [];
        jobs.push(database.webUser.findUnique({ where: { id: "one" } }));
        jobs.push(database.webUser.findUnique({ where: { id: "two" } }));
        await Promise.all(Array.from(jobs));
      });
    `));

    expect(violations).toEqual([
      expect.objectContaining({ line: 5, combinator: "Promise.all" }),
      expect.objectContaining({ line: 10, combinator: "Promise.all" }),
      expect.objectContaining({ line: 18, combinator: "Promise.all" }),
    ]);
  });

  it("follows destructured clients, captured closures, and bound APIs", () => {
    const violations = transactionConcurrencyViolations(inlineSource(`
      async function helper({ database }: { database: Prisma.TransactionClient }) {
        const lookup = (id: string) => database.webUser.findUnique({ where: { id } });
        const together = Promise.all.bind(Promise);
        return together([lookup("one"), lookup("two")]);
      }

      const { $transaction: runTransaction } = prisma;
      await runTransaction(async (tx) => helper({ database: tx }));
    `));

    expect(violations).toEqual([
      expect.objectContaining({
        line: 5,
        combinator: "Promise.all",
        transactionClient: "database",
      }),
    ]);
  });

  it("tracks destructured transaction callbacks and delegate methods", () => {
    const violations = transactionConcurrencyViolations(inlineSource(`
      prisma.$transaction(async ({ webUser }) => Promise.all([
        webUser.findUnique({ where: { id: "one" } }),
        webUser.findFirst({ where: { id: "two" } }),
      ]));

      prisma.$transaction(async (tx) => {
        const { findUnique } = tx.webUser;
        return Promise.all([
          findUnique({ where: { id: "one" } }),
          findUnique({ where: { id: "two" } }),
        ]);
      });

      declare const database: PrismaClient;
      database.$transaction(async (tx) => Promise.all([
        tx.webUser.findUnique({ where: { id: "typed-one" } }),
        tx.webUser.findUnique({ where: { id: "typed-two" } }),
      ]));
    `));

    expect(violations).toEqual([
      expect.objectContaining({ line: 2, combinator: "Promise.all" }),
      expect.objectContaining({ line: 9, combinator: "Promise.all" }),
      expect.objectContaining({ line: 16, combinator: "Promise.all" }),
    ]);
  });

  it("recognizes imported Prisma aliases without matching lookalike names", () => {
    const violations = transactionConcurrencyViolations(inlineSource(`
      import { prisma as importedDatabase } from "@/backend/database/prisma";
      const databaseAlias = importedDatabase;

      databaseAlias.$transaction(async (tx) => Promise.all([
        tx.webUser.findUnique({ where: { id: "one" } }),
        tx.webUser.findUnique({ where: { id: "two" } }),
      ]));

      notPrisma.$transaction(async (tx) => Promise.all([
        tx.webUser.findUnique({ where: { id: "lookalike-one" } }),
        tx.webUser.findUnique({ where: { id: "lookalike-two" } }),
      ]));
    `));

    expect(violations).toEqual([
      expect.objectContaining({ line: 5, combinator: "Promise.all" }),
    ]);
  });

  it("reports detached transaction promise chains separately", () => {
    const violations = transactionConcurrencyViolations(inlineSource(`
      prisma.$transaction(async (tx) => {
        tx.webUser.findUnique({ where: { id: "one" } }).then(consume);
        void tx.webUser.findUnique({ where: { id: "two" } }).then(consume);
        await tx.webUser.findUnique({ where: { id: "awaited" } }).then(consume);
        return tx.webUser.findUnique({ where: { id: "returned" } }).then(consume);
      });
    `));

    expect(violations).toEqual([
      expect.objectContaining({ line: 3, combinator: "detached transaction start" }),
      expect.objectContaining({ line: 4, combinator: "detached transaction start" }),
    ]);
  });

  it("reports discarded helper promises and unconsumed stored queries", () => {
    const violations = transactionConcurrencyViolations(inlineSource(`
      async function lookup(database: Prisma.TransactionClient, id: string) {
        return database.webUser.findUnique({ where: { id } });
      }

      prisma.$transaction(async (tx) => {
        void lookup(tx, "discarded");
        const ignored = tx.webUser.findUnique({ where: { id: "ignored" } }).then(consume);
        const pending = lookup(tx, "awaited");
        await pending;
        return lookup(tx, "returned");
      });
    `));

    expect(violations).toEqual([
      expect.objectContaining({ line: 7, combinator: "detached transaction start" }),
      expect.objectContaining({ line: 8, combinator: "detached transaction start" }),
    ]);
  });

  it("does not treat promises nested in returned containers as awaited", () => {
    const violations = transactionConcurrencyViolations(inlineSource(`
      prisma.$transaction(async (tx) => {
        const pending = tx.webUser.findUnique({ where: { id: "object" } }).then(consume);
        return { result: pending };
      });

      prisma.$transaction(async (tx) => {
        const pending = tx.webUser.findUnique({ where: { id: "array" } }).then(consume);
        return [pending];
      });
    `));

    expect(violations).toEqual([
      expect.objectContaining({ line: 3, combinator: "detached transaction start" }),
      expect.objectContaining({ line: 8, combinator: "detached transaction start" }),
    ]);
  });

  it("applies transaction aliases only after their assignment", () => {
    const violations = transactionConcurrencyViolations(inlineSource(`
      prisma.$transaction(async (tx) => {
        let database = tx;
        await database.webUser.findUnique({ where: { id: "sequential" } });

        database = unrelatedDatabase;
        await Promise.all([
          database.webUser.findUnique({ where: { id: "safe-one" } }),
          database.webUser.findUnique({ where: { id: "safe-two" } }),
        ]);

        database = tx;
        await Promise.all([
          database.webUser.findUnique({ where: { id: "unsafe-one" } }),
          database.webUser.findUnique({ where: { id: "unsafe-two" } }),
        ]);

        database = unrelatedDatabase;
        await Promise.all([
          database.webUser.findUnique({ where: { id: "safe-three" } }),
          database.webUser.findUnique({ where: { id: "safe-four" } }),
        ]);
      });
    `));

    expect(violations).toEqual([
      expect.objectContaining({ line: 13, combinator: "Promise.all" }),
    ]);
  });

  it("does not clear transaction aliases on conditional assignments", () => {
    const violations = transactionConcurrencyViolations(inlineSource(`
      prisma.$transaction(async (tx) => {
        let database = tx;
        if (useOther) database = unrelatedDatabase;
        await Promise.all([
          database.webUser.findUnique({ where: { id: "possibly-tx-one" } }),
          database.webUser.findUnique({ where: { id: "possibly-tx-two" } }),
        ]);

        database = unrelatedDatabase;
        await Promise.all([
          database.webUser.findUnique({ where: { id: "safe-one" } }),
          database.webUser.findUnique({ where: { id: "safe-two" } }),
        ]);
      });
    `));

    expect(violations).toEqual([
      expect.objectContaining({ line: 5, combinator: "Promise.all" }),
    ]);
  });

  it("allows one transaction query, sequential work, and lexically shadowed clients", () => {
    expect(transactionConcurrencyViolations(inlineSource(`
      await prisma.$transaction(async (tx) => {
        const oneQuery = tx.webUser.findUnique({ where: { id: "only-once" } });
        await Promise.all([oneQuery, oneQuery]);
        await Promise.all([
          tx.webUser.findUnique({ where: { id: "one" } }),
          Promise.resolve("safe"),
        ]);
        await tx.webUser.findUnique({ where: { id: "one" } });
        await lookupOwner(tx);
        await (async (tx) => Promise.all([
          tx.webUser.findUnique({ where: { id: "shadow-one" } }),
          tx.webUser.findUnique({ where: { id: "shadow-two" } }),
        ]))(unrelatedClient);
      });
      await prisma.$transaction([
        prisma.webUser.findUnique({ where: { id: "one" } }),
        prisma.webUser.findUnique({ where: { id: "two" } }),
      ]);
      await notPrisma.$transaction(async (tx) => Promise.all([
        tx.webUser.findUnique({ where: { id: "not-prisma-one" } }),
        tx.webUser.findUnique({ where: { id: "not-prisma-two" } }),
      ]));
    `))).toEqual([]);
  });

  it("keeps every production interactive transaction serialized", () => {
    const violations = transactionConcurrencyViolations(
      globSync("src/**/*.{ts,tsx}").map((file) => ({
        file,
        sourceText: readFileSync(file, "utf8"),
      })),
    );

    expect(violations).toEqual([]);
  }, process.platform === "win32" ? 60_000 : 30_000);
});
