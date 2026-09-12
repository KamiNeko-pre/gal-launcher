function summarizeCoverSearch({ candidateCount = 0, attempts = [] } = {}) {
  if (candidateCount > 0) return { status: "candidates" };
  if (attempts.length > 0 && attempts.every((attempt) => !attempt.ok)) {
    return { status: "network_error" };
  }
  return { status: "no_match" };
}

module.exports = { summarizeCoverSearch };
