-- ============================================================
-- Client onboarding preferences
-- Run this in Supabase SQL Editor.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.client_preferences (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Step 1: single-select. One of:
  --   'stop'           — Ho bisogno di fermarmi
  --   'self_discovery' — Voglio capire qualcosa di me
  --   'transition'     — Sto attraversando un cambiamento
  --   'curiosity'      — Sono curioso/a
  --   'support_other'  — Cerco supporto per qualcuno
  intent              TEXT,

  -- Step 2: multi-select. Subset of:
  --   body, mind, energy, relationships, life_direction,
  --   daily_ritual, family_roots, inner_listening
  focus_areas         TEXT[] DEFAULT '{}'::text[],

  -- Step 3: multi-select. Canonical category_key values from practices.
  -- 'none' is a valid sentinel meaning "I don't know any of these yet".
  familiar_practices  TEXT[] DEFAULT '{}'::text[],

  -- Step 4: multi-select. Subset of:
  --   energetic, self_knowledge, spiritual, symbolic, body_care, open
  approaches          TEXT[] DEFAULT '{}'::text[],

  -- Step 5: single-select. One of:
  --   'asap'        — Appena possibile
  --   'this_week'   — Questa settimana
  --   'exploring'   — Sto solo esplorando
  timing              TEXT,

  -- Step 6: free text, max 500 char (enforced server-side too)
  notes               TEXT,

  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_preferences_user
  ON public.client_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_client_preferences_completed
  ON public.client_preferences(completed_at)
  WHERE completed_at IS NOT NULL;

-- RLS — user owns their own row, admin can read all
ALTER TABLE public.client_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cp_self_all ON public.client_preferences;
CREATE POLICY cp_self_all ON public.client_preferences
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS cp_admin_read ON public.client_preferences;
CREATE POLICY cp_admin_read ON public.client_preferences
  FOR SELECT USING (is_admin());

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.touch_client_preferences_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_client_preferences ON public.client_preferences;
CREATE TRIGGER trg_touch_client_preferences
  BEFORE UPDATE ON public.client_preferences
  FOR EACH ROW EXECUTE FUNCTION public.touch_client_preferences_updated_at();
