import 'react-native-url-polyfill/auto';

import { createClient } from '@supabase/supabase-js';

import { authStorage } from './authStorage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase env vars. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: authStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Library default is implicit, so a reset email redirects with
    // `#access_token&type=recovery` (not `?code=`). That hash works in any
    // browser, including a reset requested on the phone and opened on the web.
    // PKCE would store the code verifier on the device that requested the email
    // and the web page could not exchange it. Detection stays off so only
    // `/reset-password` reads the hash.
    flowType: 'implicit',
    detectSessionInUrl: false,
  },
});
