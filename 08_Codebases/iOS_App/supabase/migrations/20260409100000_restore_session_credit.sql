-- Restore a session credit when a credit-booked session is cancelled.
-- Mirrors use_session_credit but increments instead of decrementing.
create or replace function public.restore_session_credit(p_credit_id uuid)
returns public.session_credits
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_credit public.session_credits;
begin
    update public.session_credits
    set
        sessions_remaining = sessions_remaining + 1,
        updated_at = now()
    where id = p_credit_id
      and sessions_remaining < sessions_total
    returning *
    into v_credit;

    if not found then
        raise exception 'Session credit not found or already at maximum';
    end if;

    return v_credit;
end;
$$;

grant execute on function public.restore_session_credit(uuid) to authenticated;
