-- B1.4b (docs/B1-BROADCAST-DESIGN.md §8): every reader is on game_airings, so retire the old
-- network-only compatibility table. Its index, RLS policy, grants and service CHECK go with it;
-- is_valid_airing_network stays for game_airings.network.
DROP TABLE public.game_broadcasts;
