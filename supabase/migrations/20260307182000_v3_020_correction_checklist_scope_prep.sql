-- V3-020 prep: commit new review comment scope enum values before using them.

do $$
begin
  alter type public.estimate_review_comment_scope add value if not exists 'exception';
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter type public.estimate_review_comment_scope add value if not exists 'hypothesis';
exception
  when duplicate_object then null;
end
$$;
