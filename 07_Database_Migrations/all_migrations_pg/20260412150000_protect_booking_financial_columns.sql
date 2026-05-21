-- CRITICAL SECURITY FIX: Prevent clients and therapists from modifying
-- financial and status columns on bookings via direct UPDATE.
--
-- The RLS policy "Clients can update own bookings" allows UPDATE on all columns.
-- PostgreSQL RLS cannot restrict which columns are modified, only the resulting row.
-- This trigger rejects changes to protected columns unless the caller is service_role.

create or replace function public.protect_booking_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    -- service_role (used by Edge Functions, webhooks, pg_cron) is allowed to change anything
    if current_setting('request.jwt.claim.role', true) = 'service_role' then
        return new;
    end if;

    -- Block changes to financial columns
    if new.price is distinct from old.price then
        raise exception 'Cannot modify booking price';
    end if;
    if new.platform_fee is distinct from old.platform_fee then
        raise exception 'Cannot modify platform fee';
    end if;
    if new.therapist_payout is distinct from old.therapist_payout then
        raise exception 'Cannot modify therapist payout';
    end if;
    if new.discount is distinct from old.discount then
        raise exception 'Cannot modify discount';
    end if;

    -- Block changes to payment linkage
    -- Allow first assignment (NULL → value) but block subsequent changes
    if new.stripe_payment_intent_id is distinct from old.stripe_payment_intent_id
       and old.stripe_payment_intent_id is not null then
        raise exception 'Cannot modify payment intent';
    end if;

    -- Block status changes except: client can cancel their own pending/confirmed booking
    if new.status is distinct from old.status then
        -- Clients: can only set status to 'cancelled'
        if (select auth.uid())::text = old.client_id then
            if new.status != 'cancelled' then
                raise exception 'Clients can only cancel bookings';
            end if;
            if old.status not in ('pending', 'confirmed') then
                raise exception 'Cannot cancel a booking in status: %', old.status;
            end if;
        -- Therapists: can set status to 'cancelled', 'in_progress', 'completed', 'no_show'
        elsif (select auth.uid())::text = old.therapist_id then
            if new.status not in ('cancelled', 'in_progress', 'completed', 'no_show') then
                raise exception 'Invalid status transition for therapist';
            end if;
        else
            raise exception 'Not authorized to change booking status';
        end if;
    end if;

    -- Block changes to ownership fields
    if new.client_id is distinct from old.client_id then
        raise exception 'Cannot modify booking client';
    end if;
    if new.therapist_id is distinct from old.therapist_id then
        raise exception 'Cannot modify booking therapist';
    end if;

    return new;
end;
$$;

-- Attach the trigger to the bookings table
drop trigger if exists protect_booking_columns_trigger on public.bookings;
create trigger protect_booking_columns_trigger
    before update on public.bookings
    for each row
    execute function public.protect_booking_columns();
