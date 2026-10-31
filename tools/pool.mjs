// Development-only: plays a list of fights on worker threads and returns their results in the list's order.
// Every fight is seeded, so the results do not depend on how many workers share the list.
//   Job = { teamA, teamB, seed, map?, maxRounds?, kinds: ['ai'|'greedy', 'ai'|'greedy'], budget, teams?: [i, j], weights?: [w, w] }
//   (weights: the evaluation weights each seat's ai brain judges with; omitted, the shipped WEIGHTS)
//   (teams: the named team each seat plays, for the brain seeds; defaults to the seats)
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';

const WORKER = new URL('./fight-worker.mjs', import.meta.url);

// Half the logical cores: the fights are CPU-bound and hyper-threads add little
export const defaultWorkers = () => Math.max(1, Math.floor(availableParallelism() / 2));

export async function runFights(jobs, { workers = defaultWorkers() } = {}) {
  const results = new Array(jobs.length);
  let next = 0;
  const n = Math.max(1, Math.min(workers, jobs.length));
  await Promise.all(Array.from({ length: n }, () => new Promise((resolve, reject) => {
    const w = new Worker(WORKER);
    const feed = () => {
      if (next >= jobs.length) { w.terminate().then(() => resolve()); return; }
      const id = next++;
      w.postMessage({ id, job: jobs[id] });
    };
    w.on('message', ({ id, result, error }) => {
      if (error) { w.terminate(); reject(new Error(`fight ${JSON.stringify(jobs[id])} crashed: ${error}`)); return; }
      results[id] = result;
      feed();
    });
    w.on('error', reject);
    feed();
  })));
  return results;
}
