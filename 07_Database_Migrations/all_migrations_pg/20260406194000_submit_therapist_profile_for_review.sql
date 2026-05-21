-- Allows the signed-in therapist to move their own profile from draft/changes_requested
-- to pending_review without giving the client app permission to edit admin-only columns.

create or replace function public.submit_therapist_profile_for_review()
returns public.therapist_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id text := auth.uid()::text;
    v_profile public.therapist_profiles;
begin
    if v_user_id is null then
        raise exception 'Not authenticated';
    end if;

    perform set_config('app.allow_therapist_review_submit', 'true', true);

    update public.therapist_profiles
    set
        approval_status = 'pending_review',
        updated_at = now()
    where id::text = v_user_id
      and approval_status in ('draft', 'changes_requested', 'pending_review')
    returning * into v_profile;

    if not found then
        raise exception 'Therapist profile not found or cannot be submitted for review';
    end if;

    return v_profile;
end;
$$;

grant execute on function public.submit_therapist_profile_for_review() to authenticated;

create or replace function public.protect_therapist_admin_columns()
returns trigger
language plpgsql
as $$
begin
    if current_setting('request.jwt.claims', true)::json->>'role' != 'service_role'
        and current_setting('app.allow_therapist_review_submit', true) != 'true'
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
