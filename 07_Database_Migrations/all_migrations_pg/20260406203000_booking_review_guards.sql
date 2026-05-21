-- Hardens booking/review flows that previously depended on client-side checks.

create or replace function public.protect_therapist_admin_columns()
returns trigger
language plpgsql
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

create or replace function public.validate_review_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_booking public.bookings;
begin
    select *
    into v_booking
    from public.bookings
    where id = new.booking_id;

    if not found then
        raise exception 'Booking not found for review';
    end if;

    if v_booking.client_id <> new.client_id
        or v_booking.therapist_id <> new.therapist_id
    then
        raise exception 'Review does not match booking participants';
    end if;

    if v_booking.status <> 'completed' then
        raise exception 'Only completed bookings can be reviewed';
    end if;

    return new;
end;
$$;

drop trigger if exists validate_review_booking_trigger on public.reviews;
create trigger validate_review_booking_trigger
    before insert or update of booking_id, client_id, therapist_id on public.reviews
    for each row execute function public.validate_review_booking();

create or replace function public.refresh_therapist_rating_stats(p_therapist_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform set_config('app.allow_therapist_rating_update', 'true', true);

    update public.therapist_profiles
    set
        average_rating = coalesce((
            select avg(rating)::double precision
            from public.reviews
            where therapist_id = p_therapist_id
              and is_flagged = false
        ), 0),
        total_reviews = (
            select count(*)::integer
            from public.reviews
            where therapist_id = p_therapist_id
              and is_flagged = false
        ),
        updated_at = now()
    where id = p_therapist_id;
end;
$$;

grant execute on function public.refresh_therapist_rating_stats(uuid) to authenticated;

create or replace function public.refresh_therapist_rating_stats_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op = 'DELETE' then
        perform public.refresh_therapist_rating_stats(old.therapist_id);
        return old;
    end if;

    perform public.refresh_therapist_rating_stats(new.therapist_id);

    if tg_op = 'UPDATE' and old.therapist_id <> new.therapist_id then
        perform public.refresh_therapist_rating_stats(old.therapist_id);
    end if;

    return new;
end;
$$;

drop trigger if exists refresh_therapist_rating_stats_trigger on public.reviews;
create trigger refresh_therapist_rating_stats_trigger
    after insert or update of rating, is_flagged, therapist_id or delete on public.reviews
    for each row execute function public.refresh_therapist_rating_stats_trigger();

create or replace function public.prevent_overlapping_active_bookings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_conflict_id uuid;
begin
    if new.status not in ('pending', 'confirmed', 'in_progress', 'reschedule_pending') then
        return new;
    end if;

    select b.id
    into v_conflict_id
    from public.bookings b
    where b.id <> new.id
      and b.therapist_id = new.therapist_id
      and b.status in ('pending', 'confirmed', 'in_progress', 'reschedule_pending')
      and tstzrange(
            b.scheduled_at,
            b.scheduled_at + make_interval(mins => greatest(b.duration, 1)),
            '[)'
          )
          && tstzrange(
            new.scheduled_at,
            new.scheduled_at + make_interval(mins => greatest(new.duration, 1)),
            '[)'
          )
    limit 1;

    if v_conflict_id is not null then
        raise exception 'Time slot is no longer available';
    end if;

    return new;
end;
$$;

drop trigger if exists prevent_overlapping_active_bookings_trigger on public.bookings;
create trigger prevent_overlapping_active_bookings_trigger
    before insert or update of therapist_id, scheduled_at, duration, status on public.bookings
    for each row execute function public.prevent_overlapping_active_bookings();
