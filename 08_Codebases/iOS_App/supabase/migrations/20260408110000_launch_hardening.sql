-- Launch hardening for paid packs, session credits, and sensitive storage.

-- Session credits are created by the Stripe webhook using the service role.
-- Clients can read their own credits but cannot mint or arbitrarily update them.
drop policy if exists "Clients can insert own credits" on public.session_credits;
drop policy if exists "Clients can update own credits" on public.session_credits;

create unique index if not exists idx_session_credits_pack_booking_id
    on public.session_credits(pack_booking_id);

create or replace function public.use_session_credit(p_credit_id uuid)
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
        sessions_remaining = sessions_remaining - 1,
        updated_at = now()
    where id = p_credit_id
      and client_id = auth.uid()
      and sessions_remaining > 0
    returning *
    into v_credit;

    if not found then
        raise exception 'Session credit is unavailable or exhausted';
    end if;

    return v_credit;
end;
$$;

grant execute on function public.use_session_credit(uuid) to authenticated;

-- Certification uploads can contain sensitive documents. Keep the bucket private
-- and restrict direct storage object access to the owner folder.
update storage.buckets
set public = false
where id = 'certificates';

drop policy if exists "Anyone can read certificates" on storage.objects;
drop policy if exists "Authenticated users can upload certificates" on storage.objects;
drop policy if exists "Users can view own certificates" on storage.objects;
drop policy if exists "Users can upload own certificates" on storage.objects;
drop policy if exists "Users can update own certificates" on storage.objects;
drop policy if exists "Users can delete own certificates" on storage.objects;

create policy "Users can view own certificates"
    on storage.objects for select
    using (
        bucket_id = 'certificates'
        and auth.uid()::text = (storage.foldername(name))[1]
    );

create policy "Users can upload own certificates"
    on storage.objects for insert
    with check (
        bucket_id = 'certificates'
        and auth.uid()::text = (storage.foldername(name))[1]
    );

create policy "Users can update own certificates"
    on storage.objects for update
    using (
        bucket_id = 'certificates'
        and auth.uid()::text = (storage.foldername(name))[1]
    )
    with check (
        bucket_id = 'certificates'
        and auth.uid()::text = (storage.foldername(name))[1]
    );

create policy "Users can delete own certificates"
    on storage.objects for delete
    using (
        bucket_id = 'certificates'
        and auth.uid()::text = (storage.foldername(name))[1]
    );
