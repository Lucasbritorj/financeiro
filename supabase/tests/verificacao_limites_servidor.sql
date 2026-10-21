begin;
do $$declare r jsonb;k text:=repeat('a',64);begin
 if has_function_privilege('anon','public.consumir_limite_servidor(text,text)','execute') or has_function_privilege('authenticated','public.consumir_limite_servidor(text,text)','execute') then raise exception 'Cliente não pode controlar limites.';end if;
 for i in 1..6 loop r:=public.consumir_limite_servidor(k,'pluggy');if not (r->>'permitido')::boolean then raise exception 'Cota normal recusada.';end if;end loop;
 r:=public.consumir_limite_servidor(k,'pluggy');if (r->>'permitido')::boolean or (r->>'aguardar')::integer<1 then raise exception 'Excesso não bloqueado.';end if;
 r:=public.consumir_limite_servidor(repeat('b',64),'pluggy');if not (r->>'permitido')::boolean then raise exception 'Titulares compartilham cota.';end if;
 update public.limites_servidor set inicio=clock_timestamp()-interval '1 hour' where chave=k;
 r:=public.consumir_limite_servidor(k,'pluggy');if not (r->>'permitido')::boolean then raise exception 'Janela não reinicia.';end if;
 begin perform public.consumir_limite_servidor(k,'arbitrario');raise exception 'Ação arbitrária aceita.';exception when sqlstate 'FW400' then null;end;
 raise notice 'OK: 5/5 asserts';
end $$;
rollback;
