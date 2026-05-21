-- Standardize cancellation/refund policy for every therapist.
-- The app now presents one global refund policy instead of therapist-selected tiers.

update public.therapist_profiles
set cancellation_policy = 'flexible',
    updated_at = now()
where cancellation_policy is distinct from 'flexible';

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'therapist_profiles_standard_cancellation_policy'
          and conrelid = 'public.therapist_profiles'::regclass
    ) then
        alter table public.therapist_profiles
            add constraint therapist_profiles_standard_cancellation_policy
            check (cancellation_policy = 'flexible');
    end if;
end $$;

comment on column public.therapist_profiles.cancellation_policy is
    'Legacy-compatible storage for the single global cancellation policy. Must remain flexible.';
