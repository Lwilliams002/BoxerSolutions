/**
 * Route optimization provider abstraction. The default implementation is a
 * time-window-aware nearest-neighbor heuristic; swap in an external provider
 * (Google Routes, Mapbox Optimization, etc.) by implementing RouteOptimizer.
 */
export interface OptimizableStop {
  stopId: string;
  latitude: number;
  longitude: number;
  windowStart: string; // "HH:MM"
  windowEnd: string;
  durationMinutes: number;
}

export interface OptimizedStop {
  stopId: string;
  order: number;
  estimatedArrival: string; // "HH:MM"
  estimatedTravelMinutes: number;
}

export interface RouteOptimizer {
  name: string;
  optimize(
    start: { latitude: number; longitude: number; workStart: string; workEnd: string },
    stops: OptimizableStop[],
  ): Promise<OptimizedStop[]>;
}

const AVG_SPEED_KMH = 45;

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function toHHMM(minutes: number) {
  const h = Math.floor(minutes / 60) % 24;
  const m = Math.round(minutes % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Greedy nearest-neighbor with hard time-window constraints:
 * at each step pick the closest feasible stop (arrival before its window end,
 * waiting until window start if early). Never violates appointment windows —
 * infeasible stops fall back to window-start ordering at the end.
 */
class NearestNeighborOptimizer implements RouteOptimizer {
  name = 'nearest-neighbor';

  async optimize(
    start: { latitude: number; longitude: number; workStart: string; workEnd: string },
    stops: OptimizableStop[],
  ): Promise<OptimizedStop[]> {
    const remaining = [...stops];
    const result: OptimizedStop[] = [];
    let curLat = start.latitude;
    let curLng = start.longitude;
    let clock = toMinutes(start.workStart);
    let order = 1;

    while (remaining.length > 0) {
      let bestIdx = -1;
      let bestScore = Infinity;
      let bestTravel = 0;
      let bestArrival = 0;

      for (let i = 0; i < remaining.length; i++) {
        const s = remaining[i];
        const travel = Math.ceil((haversineKm(curLat, curLng, s.latitude, s.longitude) / AVG_SPEED_KMH) * 60);
        const arrivalRaw = clock + travel;
        const arrival = Math.max(arrivalRaw, toMinutes(s.windowStart)); // wait if early
        if (arrival > toMinutes(s.windowEnd)) continue; // hard window constraint
        const waitPenalty = arrival - arrivalRaw;
        const score = travel + waitPenalty * 0.5;
        if (score < bestScore) {
          bestScore = score;
          bestIdx = i;
          bestTravel = travel;
          bestArrival = arrival;
        }
      }

      if (bestIdx === -1) {
        // No feasible next stop: append the rest ordered by window start.
        remaining
          .sort((a, b) => toMinutes(a.windowStart) - toMinutes(b.windowStart))
          .forEach((s) => {
            const travel = Math.ceil((haversineKm(curLat, curLng, s.latitude, s.longitude) / AVG_SPEED_KMH) * 60);
            const arrival = Math.max(clock + travel, toMinutes(s.windowStart));
            result.push({ stopId: s.stopId, order: order++, estimatedArrival: toHHMM(arrival), estimatedTravelMinutes: travel });
            clock = arrival + s.durationMinutes;
            curLat = s.latitude;
            curLng = s.longitude;
          });
        break;
      }

      const chosen = remaining.splice(bestIdx, 1)[0];
      result.push({
        stopId: chosen.stopId,
        order: order++,
        estimatedArrival: toHHMM(bestArrival),
        estimatedTravelMinutes: bestTravel,
      });
      clock = bestArrival + chosen.durationMinutes;
      curLat = chosen.latitude;
      curLng = chosen.longitude;
    }

    return result;
  }
}

export const routeOptimizer: RouteOptimizer = new NearestNeighborOptimizer();
