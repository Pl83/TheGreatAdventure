// Development-only: a worker thread that plays the fights it is sent (see pool.mjs). Each worker has its own
// copy of the engine, so fights in different workers never share state.
//   in:  { id, job: { teamA, teamB, seed, map?, maxRounds?, kinds: [kind, kind], budget } }
//   out: { id, result: FightResult } | { id, error: string }
import { parentPort } from 'node:worker_threads';
import { playFight, makeBrain } from './fight.mjs';

parentPort.on('message', async ({ id, job }) => {
  try {
    const { kinds, budget, ...fight } = job;
    const brains = kinds.map((kind, team) => makeBrain(kind, budget, job.seed, job.teams?.[team] ?? team));
    delete fight.teams;
    parentPort.postMessage({ id, result: await playFight({ ...fight, brains }) });
  } catch (err) {
    parentPort.postMessage({ id, error: `${err.stack ?? err}` });
  }
});
