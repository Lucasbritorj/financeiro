-- =====================================================================
-- verificacao_importacao_guard.sql — executar no SQL Editor. Não persiste.
-- Achado #7 (migration 0018): criar_importacao deve rejeitar 'valor'
-- fracionário com FW400 + hint, em vez do erro cru do cast jsonb->bigint.
-- =====================================================================
begin;

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-0000000000aa', 'guard@local.dev')
on conflict (id) do nothing;

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_ok  boolean := false;
  v_res jsonb;
begin
  -- [IMP-1] valor fracionário => FW400 (não erro cru do Postgres).
  begin
    perform public.criar_importacao(
      'CSV', '[{"data":"2026-03-05","valor":4200.5,"descricao":"teste fracao"}]'::jsonb);
  exception
    when sqlstate 'FW400' then
      v_ok := true;
    when others then
      raise exception 'FALHA [IMP-1]: esperado FW400, veio % (%)', sqlstate, sqlerrm;
  end;
  if not v_ok then
    raise exception 'FALHA [IMP-1]: valor fracionario passou (deveria ser FW400)';
  end if;

  -- [IMP-2] valor inteiro (centavos) válido => sucesso, 1 linha.
  v_res := public.criar_importacao(
    'CSV', '[{"data":"2026-03-05","valor":-4200,"descricao":"mercado teste"}]'::jsonb);
  if (v_res->>'linhas')::int <> 1 then
    raise exception 'FALHA [IMP-2]: importacao valida nao retornou 1 linha (%)', v_res;
  end if;

  raise notice 'OK: 2/2 asserts (guarda de valor da importacao: IMP-1 fracao=FW400, IMP-2 inteiro=ok).';
end $$;

rollback;
