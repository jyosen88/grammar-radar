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
--    明确的权重规则（每个关键词在一张卡片上取三个字段中的最高档）：
--      · 完整词组匹配（任一字段完整包含关键词，如“the number of”）→ 5 分
--      · 部分匹配（任一字段命中合格片段，如“主谓一致”命中部分字段）→ 3 分
--    命中多个不同关键词时得分累加。
--    精准词组亲和规则（直接加在总分上）：
--      · 关键词含 'the number of' 或 'a number of' → M-002 +10
--      · 关键词含 '复合名词'、'man/woman' 或 '名词作定语' → N-006 +10
--    新增规则时在 c_affinity 的 case 里追加 when 分支即可。
--    按总分从高到低只返回前 p_limit 条。
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
    select coalesce(sum(base_score + affinity), 0) as score
    from unnest(p_keywords) as raw_kw
    cross join lateral (select lower(raw_kw) as kw) c_kw
    cross join lateral (select char_length(kw) as kl) c_len
    cross join lateral (select floor(kl / 2.0)::int + 1 as min_len) c_min
    left join lateral public.chunk_best(kw, lower(coalesce(g.title, '')), min_len) bt on true
    left join lateral public.chunk_best(kw, lower(coalesce(g.notes, '')), min_len) bn on true
    left join lateral public.chunk_best(kw, lower(coalesce(g.rules_table::text, '')), min_len) br on true
    cross join lateral (
      select case
               -- 完整词组匹配：任一字段完整包含关键词 → 5 分
               when bt.hit_len = kl or bn.hit_len = kl or br.hit_len = kl
                    then 5.0
               -- 部分匹配：任一字段命中合格片段 → 3 分
               when bt.hit_len is not null or bn.hit_len is not null
                    or br.hit_len is not null
                    then 3.0
               else 0
             end as base_score
    ) c_base
    cross join lateral (
      select case
               when g.card_code = 'M-002'
                    and (kw like '%the number of%' or kw like '%a number of%')
                    then 10.0
               when g.card_code = 'N-006'
                    and (kw like '%复合名词%' or kw like '%man/woman%'
                         or kw like '%名词作定语%')
                    then 10.0
               else 0
             end as affinity
    ) c_affinity
  ) sc
  where sc.score > 0
  order by sc.score desc, g.card_code
  limit least(greatest(p_limit, 1), 10)
$$;

-- 3. 允许匿名用户调用
grant execute on function public.chunk_best(text, text, integer) to anon, authenticated;
grant execute on function public.search_grammar_cards(text[], integer) to anon, authenticated;
