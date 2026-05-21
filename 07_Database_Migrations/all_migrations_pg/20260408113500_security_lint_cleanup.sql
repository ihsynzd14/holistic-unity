-- Clean up Supabase advisor findings that matter before App Store/TestFlight.

-- Keep the view subject to the querying user's RLS policies instead of the
-- creator's privileges.
alter view public.user_display_info set (security_invoker = true);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create or replace function public.protect_therapist_admin_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if current_setting('request.jwt.claims', true)::json->>'role' != 'service_role'
        and current_setting('app.allow_therapist_review_submit', true) != 'true'
        and current_setting('app.allow_therapist_rating_update', true) != 'true'
    then
        new.is_approved := old.is_approved;
        new.approval_status := old.approval_status;
        new.is_verified := old.is_verified;
        new.average_rating := old.average_rating;
        new.total_reviews := old.total_reviews;
        new.stripe_connected_account_id := old.stripe_connected_account_id;
        new.stripe_account_status := old.stripe_account_status;
    end if;

    return new;
end;
$$;

create or replace function public.protect_review_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if auth.uid() = old.therapist_id and auth.uid() != old.client_id then
        new.rating := old.rating;
        new.text := old.text;
        new.client_name := old.client_name;
        new.client_photo_url := old.client_photo_url;
        new.is_flagged := old.is_flagged;
        new.client_id := old.client_id;
        new.therapist_id := old.therapist_id;
        new.booking_id := old.booking_id;
    end if;

    return new;
end;
$$;

create or replace function public.update_therapist_rating()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    avg_r double precision;
    total_r integer;
begin
    select avg(rating)::double precision, count(*)
    into avg_r, total_r
    from public.reviews
    where therapist_id = new.therapist_id
      and is_flagged = false;

    update public.therapist_profiles
    set average_rating = coalesce(avg_r, 0),
        total_reviews  = coalesce(total_r, 0),
        updated_at     = now()
    where id = new.therapist_id;

    return new;
end;
$$;

-- Remove duplicate indexes reported by the database advisor. Keep the
-- *_id names because they are present in the baseline migration.
drop index if exists public.idx_payment_methods_user;
drop index if exists public.idx_transactions_booking;
drop index if exists public.idx_transactions_client;
drop index if exists public.idx_transactions_therapist;
