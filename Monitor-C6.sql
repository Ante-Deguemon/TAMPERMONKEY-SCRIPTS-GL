/* 0. Limpar a estrutura antiga (CUIDADO: Isso apaga os dados atuais das tabelas) */
DROP FUNCTION IF EXISTS tentar_entrar(text);
DROP TABLE IF EXISTS controle_sessao CASCADE;
DROP TABLE IF EXISTS fila_espera CASCADE;

/* 1. Criar as tabelas */
create table controle_sessao (
  id int primary key,
  usuario_ativo text,  -- Nome atualizado para bater com o JS v6.0
  inicio timestamp,
  ativo boolean
);

-- Insere a linha base de controle
insert into controle_sessao values (1, null, null, false);

create table fila_espera (
  id uuid primary key default gen_random_uuid(),
  usuario text,
  entrou_em timestamp default now()
);

/* 2. Main RPC (Procedure) com Anti Fura-Fila */
create or replace function tentar_entrar(novo_usuario text)
returns text
language plpgsql
security definer
as $$
declare
    sessao controle_sessao;
    posicao int;
    primeiro_da_fila text;
begin
    -- Trava a linha para evitar condição de corrida (dois acessando no mesmo milissegundo)
    select * into sessao from controle_sessao where id = 1 for update;

    -- Se o usuário não está na fila, coloca ele nela
    if not exists (select 1 from fila_espera where usuario = novo_usuario) then
        insert into fila_espera (usuario) values (novo_usuario);
    end if;

    -- Descobre quem é o primeiro da fila
    select usuario into primeiro_da_fila
    from fila_espera
    order by entrou_em asc
    limit 1;

    -- Verifica se pode entrar na vaga (Está livre? Ou é o próprio usuário? Ou inativo há >10min?)
    if sessao.ativo = false 
       or sessao.usuario_ativo = novo_usuario 
       or (now() - sessao.inicio) > interval '10 minutes' then
       
       -- Só deixa entrar se for o PRIMEIRO da fila ou se ele já for o dono da sessão
       if primeiro_da_fila = novo_usuario or sessao.usuario_ativo = novo_usuario then
           -- Atualiza a sessão
           update controle_sessao
           set usuario_ativo = novo_usuario,
               inicio = now(),
               ativo = true
           where id = 1;

           -- Remove o usuário da fila, pois ele já entrou
           delete from fila_espera where usuario = novo_usuario;

           return 'ENTROU';
       end if;
    end if;

    -- Se não entrou, calcula a posição dele na fila
    select count(*) into posicao
    from fila_espera
    where entrou_em <= (
        select entrou_em from fila_espera where usuario = novo_usuario
    );

    return 'FILA:' || posicao;
end;
$$;

/* 3. Configurar RLS (Row Level Security) e Permissões */
alter table controle_sessao enable row level security;
alter table fila_espera enable row level security;

-- Libera execução da função para o frontend (via key anônima)
grant execute on function tentar_entrar to anon;
grant usage on schema public to anon;

-- Permite que o JS leia, libere a vaga (PATCH)
create policy "Acesso total controle_sessao" 
on controle_sessao for all 
to anon 
using (true) 
with check (true);

-- Permite que o JS leia a fila e saia dela (DELETE)
create policy "Acesso total fila_espera" 
on fila_espera for all 
to anon 
using (true) 
with check (true);