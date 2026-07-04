// Privacy-respecting play counters for /admin. In-memory (resets on
// redeploy — acceptable for a hobby deployment; note in PROGRESS.md).
export const stats = {
  startedAt: new Date().toISOString(),
  roomsCreated: 0,
  runsCompleted: 0,
  bestSurvivalSec: 0,
  duelsPlayed: 0,
  trainingsPlayed: 0,
};
