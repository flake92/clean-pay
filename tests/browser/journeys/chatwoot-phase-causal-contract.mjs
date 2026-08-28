const APPLICATION_ORIGIN = "https://pay.ci.clean-pay.dev";
const EXACT_LOGIN_URL = `${APPLICATION_ORIGIN}/login?redirect_to=%2Fcabinet`;
const EXACT_CABINET_URL = `${APPLICATION_ORIGIN}/cabinet`;
const EXACT_BOUNDARY_METHODS = Object.freeze(["setUser", "identity.confirmed"]);

export function createChatwootPhaseCausalContract(maximumEvents = 32) {
  if (!Number.isSafeInteger(maximumEvents) || maximumEvents < 9 || maximumEvents > 256) {
    fail("Chatwoot causal event bound is invalid.");
  }
  const records = [];
  const ordinals = {};
  let postClearOffset;
  let preClearSealed = false;
  let firstSetUserConversationCookiePresent;

  const append = (record) => {
    records.push(Object.freeze(record));
    if (records.length > maximumEvents) fail("Chatwoot causal event ledger overflowed.");
  };

  return Object.freeze({
    sealPreClearGeneration() {
      if (preClearSealed || postClearOffset !== undefined
        || Object.keys(ordinals).length !== 0 || records.length < 1
        || !records.some(({ kind }) => kind === "document")
        || !records.some(({ kind }) => kind === "boundary")) {
        fail("Chatwoot pre-clear causal generation cannot be sealed at this boundary.");
      }
      preClearSealed = true;
      return Object.freeze({ eventCount: records.length, status: "pre-clear-sealed" });
    },
    markClear(presence) {
      assertPresence(presence, "clear boundary");
      if (!preClearSealed || postClearOffset !== undefined || Object.keys(ordinals).length !== 0
        || presence.conversationCookiePresent || presence.userCookiePresent) {
        fail("Chatwoot causal clear boundary is not exact or was marked twice.");
      }
      postClearOffset = records.length;
      ordinals.clearVerified = 1;
    },
    observeDocument(input) {
      exactKeys(input, ["presence", "url"], "document causal event");
      const presence = assertPresence(input.presence, "document causal event");
      const url = exactApplicationUrl(input.url, "document causal event");
      if (preClearSealed && postClearOffset === undefined) {
        fail("Chatwoot causal document changed after the pre-clear generation seal.");
      }
      append({ kind: "document", url: url.href, presence });
      if (postClearOffset === undefined || records.length <= postClearOffset) return "pre-clear";
      if (url.href === EXACT_LOGIN_URL) {
        if (Object.hasOwn(ordinals, "loginDocumentReached")
          || presence.conversationCookiePresent || presence.userCookiePresent) {
          fail("Post-clear login document violates its exact negative checkpoint.");
        }
        ordinals.loginDocumentReached = 2;
        return "login-document";
      }
      if (url.href === EXACT_CABINET_URL) {
        if (ordinals.negativeLoginCheckpoint !== 3
          || Object.hasOwn(ordinals, "cabinetDocumentReached")
          || presence.conversationCookiePresent || presence.userCookiePresent) {
          fail("Cabinet document did not begin at the exact cookie-free boundary.");
        }
        ordinals.cabinetDocumentReached = 4;
        return "cabinet-document";
      }
      fail("Post-clear Chatwoot document escaped the exact direct-cabinet flow.");
    },
    markNegativeLoginCheckpoint(input) {
      exactKeys(input, ["presence", "url"], "negative login checkpoint");
      const presence = assertPresence(input.presence, "negative login checkpoint");
      const url = exactApplicationUrl(input.url, "negative login checkpoint");
      if (url.href !== EXACT_LOGIN_URL || ordinals.loginDocumentReached !== 2
        || Object.hasOwn(ordinals, "negativeLoginCheckpoint")
        || presence.conversationCookiePresent || presence.userCookiePresent
        || records.slice(postClearOffset).some(({ kind }) => kind === "boundary")) {
        fail("Chatwoot negative login checkpoint observed premature identity state.");
      }
      ordinals.negativeLoginCheckpoint = 3;
    },
    observeBoundary(input) {
      exactKeys(input, ["method", "presence", "url"], "boundary causal event");
      const presence = assertPresence(input.presence, "boundary causal event");
      const url = exactApplicationUrl(input.url, "boundary causal event");
      if (!EXACT_BOUNDARY_METHODS.includes(input.method)) {
        fail("Chatwoot causal boundary method is outside the exact recreation contract.");
      }
      if (postClearOffset === undefined) {
        if (preClearSealed) {
          fail("Chatwoot causal boundary changed after the pre-clear generation seal.");
        }
        let latestDocument;
        for (let index = records.length - 1; index >= 0; index -= 1) {
          if (records[index].kind === "document") {
            latestDocument = records[index];
            break;
          }
        }
        if (!latestDocument || latestDocument.url !== url.href) {
          fail("Chatwoot pre-clear boundary escaped its exact live document.");
        }
        append({ kind: "boundary", method: input.method, url: url.href, presence });
        return "pre-clear-boundary";
      }
      if (url.href !== EXACT_CABINET_URL) {
        fail("Chatwoot post-clear boundary escaped the exact cabinet document.");
      }
      append({ kind: "boundary", method: input.method, url: url.href, presence });
      if (input.method === "setUser") {
        if (ordinals.cabinetDocumentReached !== 4
          || Object.hasOwn(ordinals, "cabinetSetUserObserved")
          || presence.userCookiePresent) {
          fail("First cabinet setUser lacks its mandatory user-cookie-negative precondition.");
        }
        firstSetUserConversationCookiePresent = presence.conversationCookiePresent;
        ordinals.cabinetSetUserObserved = 5;
        return "cabinet-set-user";
      }
      if (input.method === "identity.confirmed") {
        if (ordinals.cabinetSetUserObserved !== 5
          || Object.hasOwn(ordinals, "cabinetIdentityConfirmedObserved")
          || !presence.conversationCookiePresent || !presence.userCookiePresent) {
          fail("Cabinet identity confirmation is not causally after setUser and the cookie pair.");
        }
        ordinals.cabinetIdentityConfirmedObserved = 6;
        return "cabinet-identity-confirmed";
      }
      fail("Chatwoot causal boundary method is outside the exact recreation contract.");
    },
    observeCookiePair(presence) {
      assertPresence(presence, "settled cookie pair");
      if (ordinals.cabinetIdentityConfirmedObserved !== 6
        || Object.hasOwn(ordinals, "cabinetCookiePairObserved")
        || !presence.conversationCookiePresent || !presence.userCookiePresent) {
        fail("Chatwoot settled cookie pair is not causally after identity confirmation.");
      }
      ordinals.cabinetCookiePairObserved = 7;
    },
    markCabinetCompleted() {
      if (ordinals.cabinetCookiePairObserved !== 7
        || Object.hasOwn(ordinals, "cabinetCompleted")) {
        fail("Chatwoot cabinet completion preceded its causal cookie pair.");
      }
      ordinals.cabinetCompleted = 8;
    },
    finish(presence) {
      assertPresence(presence, "final cookie pair");
      if (postClearOffset === undefined || ordinals.cabinetCompleted !== 8
        || Object.hasOwn(ordinals, "finalCookiePairObserved")
        || !presence.conversationCookiePresent || !presence.userCookiePresent
        || typeof firstSetUserConversationCookiePresent !== "boolean") {
        fail("Chatwoot post-clear causal evidence is incomplete.");
      }
      ordinals.finalCookiePairObserved = 9;
      const postClear = records.slice(postClearOffset);
      const setUsers = postClear.filter(({ kind, method }) => (
        kind === "boundary" && method === "setUser"
      ));
      const identityConfirmations = postClear.filter(({ kind, method }) => (
        kind === "boundary" && method === "identity.confirmed"
      ));
      if (setUsers.length !== 1 || identityConfirmations.length !== 1) {
        fail("Chatwoot post-clear boundary ledger is incomplete or duplicated.");
      }
      return Object.freeze({
        negativeLoginSetUserCount: 0,
        negativeLoginConversationCookieAbsent: true,
        negativeLoginUserCookieAbsent: true,
        firstCabinetSetUserBeforeConversationCookiePresent:
          firstSetUserConversationCookiePresent,
        firstCabinetSetUserBeforeUserCookieAbsent: true,
        cabinetIdentityConfirmedObservedAfterSetUser: true,
        cabinetIdentityConfirmedConversationCookiePresent: true,
        cabinetIdentityConfirmedUserCookiePresent: true,
        cabinetConversationCookieObservedAfterSetUser: true,
        cabinetUserCookieObservedAfterSetUser: true,
        finalCookiePairPresent: true,
        postClearSetUserCount: setUsers.length,
        cabinetSetUserCount: setUsers.length,
        cabinetIdentityConfirmedCount: identityConfirmations.length,
        eventOrdinals: Object.freeze({ ...ordinals }),
      });
    },
    snapshot() {
      return Object.freeze({
        eventCount: records.length,
        preClearSealed,
        postClearEventCount: postClearOffset === undefined ? 0 : records.length - postClearOffset,
        eventOrdinals: Object.freeze({ ...ordinals }),
      });
    },
  });
}

function exactApplicationUrl(value, label) {
  if (typeof value !== "string") fail(`Chatwoot ${label} URL is invalid.`);
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`Chatwoot ${label} URL is invalid.`);
  }
  if (url.origin !== APPLICATION_ORIGIN || url.hash || url.username || url.password || url.port) {
    fail(`Chatwoot ${label} URL escaped the exact application origin.`);
  }
  return url;
}

function assertPresence(value, label) {
  exactKeys(
    value,
    ["conversationCookiePresent", "userCookiePresent"],
    `${label} cookie presence`,
  );
  if (typeof value.conversationCookiePresent !== "boolean"
    || typeof value.userCookiePresent !== "boolean") {
    fail(`Chatwoot ${label} cookie presence is invalid.`);
  }
  return Object.freeze({
    conversationCookiePresent: value.conversationCookiePresent,
    userCookiePresent: value.userCookiePresent,
  });
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    fail(`Chatwoot ${label} has unexpected fields.`);
  }
}

function fail(message) {
  throw new Error(message);
}
