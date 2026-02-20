// src/supabase.js
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qodjotuoxrarfkxpkhbl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_gtOlPvRZMuzK02aMjWbTig_imv_CzDW';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
