function markSessionStarted(games, { gameId, sessionId, startedAt }) {
  if (!Array.isArray(games) || !gameId || !sessionId || !startedAt) return false;
  const game = games.find((item) => item?.id === gameId);
  if (!game) return false;

  const sameSession = game.currentSessionId === sessionId;
  const changed =
    !sameSession ||
    game.currentSessionStartedAt !== startedAt ||
    game.lastPlayedAt !== startedAt;
  if (!changed) return false;

  if (!sameSession) {
    game.playCount = (Number.isFinite(game.playCount) ? game.playCount : 0) + 1;
  }
  game.currentSessionId = sessionId;
  game.currentSessionStartedAt = startedAt;
  game.lastPlayedAt = startedAt;
  return true;
}

function clearSessionIfCurrent(game, sessionId) {
  if (!game || game.currentSessionId !== sessionId) return false;
  game.currentSessionId = null;
  game.currentSessionStartedAt = null;
  return true;
}

function findActiveSessionForGame(sessions, gameId) {
  if (!sessions || !gameId) return null;
  for (const session of sessions) {
    if (session?.gameId === gameId) return session;
  }
  return null;
}

function reserveGameLaunch(activeSessions, pendingGameIds, gameId) {
  if (!gameId || !pendingGameIds || pendingGameIds.has(gameId)) return false;
  if (findActiveSessionForGame(activeSessions, gameId)) return false;
  pendingGameIds.add(gameId);
  return true;
}

function releaseGameLaunch(pendingGameIds, gameId) {
  pendingGameIds?.delete(gameId);
}

function persistCompletedSession({ games, sessionId, writeLibrary, removeJournal }) {
  writeLibrary(games);
  try {
    removeJournal(sessionId);
  } catch {
    // The library already contains the completed session. A stale journal is
    // harmless and will be pruned during the next startup normalization.
  }
}

function freezeSessionCompletion(session, endedMs = Date.now()) {
  if (session.completion) return session.completion;
  session.completion = {
    endedMs,
    endedAt: new Date(endedMs).toISOString(),
    durationSeconds: Math.max(0, Math.round((endedMs - session.startedMs) / 1000))
  };
  return session.completion;
}

function persistStartedSession({
  games,
  gameId,
  sessionId,
  startedAt,
  startedMs,
  baselinePids,
  hadJournal,
  addJournal,
  writeLibrary,
  removeJournal
}) {
  addJournal(gameId, sessionId, startedAt, startedMs, { baselinePids });
  try {
    if (!Array.isArray(games) || !games.some((game) => game?.id === gameId)) {
      throw new Error("游戏不在资料库中，无法开始统计游玩时长");
    }
    if (markSessionStarted(games, { gameId, sessionId, startedAt })) {
      writeLibrary(games);
    }
  } catch (error) {
    if (!hadJournal) {
      try { removeJournal(sessionId); } catch {}
    }
    throw error;
  }
}

function mergeAuthoritativePlayState(incomingGames, persistedGames) {
  if (!Array.isArray(incomingGames)) return [];
  const persistedById = new Map(
    (Array.isArray(persistedGames) ? persistedGames : [])
      .filter((game) => game?.id)
      .map((game) => [game.id, game])
  );

  return incomingGames.map((incoming) => {
    const persisted = persistedById.get(incoming?.id);
    if (!persisted) return incoming;
    return {
      ...incoming,
      playCount: persisted.playCount ?? incoming.playCount,
      totalPlaySeconds: persisted.totalPlaySeconds ?? incoming.totalPlaySeconds,
      currentSessionId: persisted.currentSessionId ?? null,
      currentSessionStartedAt: persisted.currentSessionStartedAt ?? null,
      sessions: Array.isArray(persisted.sessions)
        ? persisted.sessions
        : (Array.isArray(incoming.sessions) ? incoming.sessions : []),
      lastPlayedAt: persisted.lastPlayedAt ?? incoming.lastPlayedAt ?? null
    };
  });
}

module.exports = {
  clearSessionIfCurrent,
  findActiveSessionForGame,
  freezeSessionCompletion,
  markSessionStarted,
  mergeAuthoritativePlayState,
  persistCompletedSession,
  persistStartedSession,
  releaseGameLaunch,
  reserveGameLaunch
};
