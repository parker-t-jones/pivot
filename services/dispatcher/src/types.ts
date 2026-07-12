/**
 * `decideAction`'s pure output (Section 8 "Delivery & action decision"). `delivery.ts` enriches this
 * with `recommendedSource`/`deepLinkUrl` before publishing (sprint decision #7) — kept separate here
 * so `decideAction` stays a pure, I/O-free function.
 */
export interface Action {
  type: 'prompt' | 'auto_switch' | 'in_app_indicator' | 'notify_only' | 'prompt_low_priority';
  cta: 'switch_primary' | 'add_to_split' | 'dismiss' | null;
}
