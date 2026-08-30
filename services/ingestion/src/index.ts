export {
  espnClient,
  type EspnClient,
  type EspnFetchFailure,
  type EspnFetchFailureKind,
  type EspnFetchResult,
} from './espn/espnClient.js';

export {
  espnTypeIdToPlayType,
  ESPN_UNKNOWN_PLAY_TYPE,
  OBSERVED_ESPN_TYPE_IDS,
} from './espn/espnPlayTypeMap.js';

export { mapEspnPlay, resolveGameContext, type EspnGameContext } from './espn/mapEspnPlay.js';

export { EspnPlaySource, type EspnPlaySourceOptions } from './espn/espnPlaySource.js';

export { IngestionError, reportShapeFailure, type ShapeFailureContext } from './espn/errors.js';

export type {
  EspnDrive,
  EspnPlay,
  EspnPlayType,
  EspnScoreboard,
  EspnSummary,
} from './espn/espnTypes.js';
