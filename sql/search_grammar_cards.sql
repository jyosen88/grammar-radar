-- 语法卡片数据库层面搜索（替代前端全量拉取 + 内存过滤）
-- 在 Supabase Dashboard 的 SQL Editor 中执行一次即可。

-- 旧版只返回最长片段长度的函数已被 chunk_best 取代，删除避免残留
drop function if exists public.chunk_hit(text, text);

-- 1. 关键词片段命中：在不短于 p_min 字的前提下，返回关键词 p_kw 中能在
--    文本 p_text 里找到的最长窗口长度 hit_len，以及该长度下有多少个不同
--    窗口命中 hit_cnt。
--    例：'复合名词复数' 在 '可数名词复数：复合名词' 中，长度 4 的窗口
--    “复合名词”“名词复数”都命中 → (hit_len=4, hit_cnt=2)。
create or replace function public.chunk_best(
  p_kw text,
  p_text text,
  p_min integer
)
returns table(hit_len integer, hit_cnt bigint)
language sql
immutable
as $$
  select s.len,
         (select count(*)
            from generate_series(1, char_length(p_kw) - s.len + 1) as g(start)
           where strpos(p_text, substring(p_kw from g.start for s.len)) > 0)::bigint
    from generate_series(p_min, char_length(p_kw)) as s(len)
   where exists (
           select 1
             from generate_series(1, char_length(p_kw) - s.len + 1) as g(start)
            where strpos(p_text, substring(p_kw from g.start for s.len)) > 0
         )
   order by s.len desc
   limit 1
$$;

-- 2. 卡片搜索 RPC：
--    每个关键词分别匹配 title / notes / rules_table 三个字段。
--    合格片段长度必须覆盖关键词一半以上（最短长度 floor(kl/2)+1，
--    如 6 字词至少命中 4 字、5 字词至少 3 字），防止“合名词”这类
--    碎片在“集合名词”等卡片上刷分。
--    字段得分 = 字段权重(title 3 / notes 3 / rules_table 2)
--               × 命中窗口长度 × 同长度命中窗口数 / 关键词长度。
--      · notes 与 title 同权：知识点的实际语境往往写在 notes 里；
--      · 同长度多窗口命中（如同时含“复合名词”和“名词复数”）能把
--        真正对口的细分卡片顶到只命中单窗口的泛匹配卡片之前。
--    任一字段出现关键词完全匹配（hit_len = kl）时，该关键词 +5 分。
--    单个关键词在一张卡片上的得分封顶 8 分（3 最高字段权重 + 5 奖励），
--    同一关键词多字段重复出现不超过“一次完全命中”档；命中多个不同
--    关键词仍可累加。按总分从高到低只返回前 p_limit 条。
create or replace function public.search_grammar_cards(
  p_keywords text[],
  p_limit integer default 3
)
returns setof public.grammar_cards
language sql
stable
as $$
  select g.*
  from public.grammar_cards g
  cross join lateral (
    select coalesce(sum(least(kw_score, 8)), 0) as score
    from unnest(p_keywords) as raw_kw
    cross join lateral (select lower(raw_kw) as kw) c_kw
    cross join lateral (select char_length(kw) as kl) c_len
    cross join lateral (select floor(kl / 2.0)::int + 1 as min_len) c_min
    left join lateral public.chunk_best(kw, lower(coalesce(g.title, '')), min_len) bt on true
    left join lateral public.chunk_best(kw, lower(coalesce(g.notes, '')), min_len) bn on true
    left join lateral public.chunk_best(kw, lower(coalesce(g.rules_table::text, '')), min_len) br on true
    cross join lateral (
      select
          coalesce(3.0 * bt.hit_len * bt.hit_cnt / kl, 0)
        + coalesce(3.0 * bn.hit_len * bn.hit_cnt / kl, 0)
        + coalesce(2.0 * br.hit_len * br.hit_cnt / kl, 0)
        + case when bt.hit_len = kl or bn.hit_len = kl or br.hit_len = kl
               then 5.0 else 0 end
        as kw_score
    ) c_score
  ) sc
  where sc.score > 0
  order by sc.score desc, g.card_code
  limit least(greatest(p_limit, 1), 10)
$$;

-- 3. 允许匿名用户调用
grant execute on function public.chunk_best(text, text, integer) to anon, authenticated;
grant execute on function public.search_grammar_cards(text[], integer) to anon, authenticated;
