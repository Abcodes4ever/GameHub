import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://yctnwgtyhxinopnhihao.supabase.co/rest/v1/';   
const SUPABASE_KEY = 'sb_publishable_OWw4edlEdonrG4Vz9f90zA_H8re1s1t';           

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);