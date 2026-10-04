import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export interface GrammarCard {
  id?: number;
  card_code: string;
  title: string;
  category: string | null;
  // rules_table 在数据库里是 jsonb（对象数组），原样保留交给渲染层解析
  rules_table: unknown;
  typical_errors: string | null;
  correct_examples: string | null;
  notes: string | null;
}
