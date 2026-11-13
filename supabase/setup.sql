/*      #########################################################################################################################################################
		Created: 13.11.2026, Marco
		Purpose: Database schema for the Boulder-Challenge web app (challenges, results and change log in Supabase)
		Description: Creates the tables for challenges and results of the running seasons plus an audit log that records every change with the participant who made it. Everyone can read, only the shared group login can write; the log is filled by triggers so clients cannot tamper with it.

		History:
		Date		Who			Change description
		#########################################################################################################################################################  */

-- Run once in the Supabase SQL editor. The script is idempotent and can be run again after changes.


/* ---------------- Tables ---------------- */

CREATE TABLE IF NOT EXISTS public.challenges (
	season_id		TEXT		NOT NULL,
	id				TEXT		NOT NULL,
	date			DATE		NOT NULL,
	label			TEXT		NOT NULL DEFAULT '',
	route			TEXT		NOT NULL,
	-- Gym-specific grade scale 4-9, NULL when not recorded
	grade			SMALLINT	CHECK (grade BETWEEN 4 AND 9),
	set_by			TEXT		NOT NULL,
	removed_from	DATE,
	notes			TEXT		NOT NULL DEFAULT '',
	-- Participant name chosen in the app; the group shares one login, so this is the only way to see who changed what
	changed_by		TEXT		NOT NULL,
	changed_at		TIMESTAMPTZ	NOT NULL DEFAULT NOW(),
	PRIMARY KEY (season_id, id)
);

CREATE TABLE IF NOT EXISTS public.results (
	season_id		TEXT		NOT NULL,
	challenge_id	TEXT		NOT NULL,
	participant_id	TEXT		NOT NULL,
	status			TEXT		NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'success', 'fail')),
	-- Mirrors "when" in data.json ('', 'live', 'makeup'); WHEN is a reserved word in Postgres
	when_type		TEXT		NOT NULL DEFAULT '',
	changed_by		TEXT		NOT NULL,
	changed_at		TIMESTAMPTZ	NOT NULL DEFAULT NOW(),
	PRIMARY KEY (season_id, challenge_id, participant_id),
	-- ON UPDATE CASCADE: the challenge id is its date, so changing the date in the app moves the results along
	FOREIGN KEY (season_id, challenge_id) REFERENCES public.challenges (season_id, id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.change_log (
	id				BIGINT		GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
	changed_at		TIMESTAMPTZ	NOT NULL DEFAULT NOW(),
	changed_by		TEXT,
	table_name		TEXT		NOT NULL,
	action			TEXT		NOT NULL,
	season_id		TEXT,
	challenge_id	TEXT,
	participant_id	TEXT,
	old_data		JSONB,
	new_data		JSONB
);

CREATE INDEX IF NOT EXISTS ix_change_log_changed_at ON public.change_log (changed_at DESC);


/* ---------------- Triggers ---------------- */

-- Server time wins over whatever the client sends
CREATE OR REPLACE FUNCTION public.set_changed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
	NEW.changed_at := NOW();
	RETURN NEW;
END;
$$;

-- SECURITY DEFINER: clients have no insert right on change_log, only this function writes to it
CREATE OR REPLACE FUNCTION public.log_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
	v_row		JSONB;
	v_old		JSONB;
	v_new		JSONB;
BEGIN
	v_old := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END;
	v_new := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END;
	v_row := COALESCE(v_new, v_old);

	IF TG_OP = 'UPDATE' THEN
		-- Nothing relevant changed (e.g. the same status saved twice)
		IF (v_old - 'changed_at' - 'changed_by') = (v_new - 'changed_at' - 'changed_by') THEN
			RETURN NEW;
		END IF;

		-- A date change on the challenge cascades into results; that is already logged on the challenge itself
		IF TG_TABLE_NAME = 'results'
			AND (v_old - 'changed_at' - 'changed_by' - 'challenge_id') = (v_new - 'changed_at' - 'changed_by' - 'challenge_id') THEN
			RETURN NEW;
		END IF;
	END IF;

	INSERT INTO public.change_log (
		changed_by,
		table_name,
		action,
		season_id,
		challenge_id,
		participant_id,
		old_data,
		new_data
	)
	VALUES (
		v_row ->> 'changed_by',
		TG_TABLE_NAME,
		TG_OP,
		v_row ->> 'season_id',
		-- challenges store their own key in "id", results in "challenge_id"
		COALESCE(v_row ->> 'challenge_id', v_row ->> 'id'),
		v_row ->> 'participant_id',
		v_old,
		v_new
	);

	RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_challenges_changed_at ON public.challenges;
CREATE TRIGGER trg_challenges_changed_at
	BEFORE INSERT OR UPDATE ON public.challenges
	FOR EACH ROW EXECUTE FUNCTION public.set_changed_at();

DROP TRIGGER IF EXISTS trg_results_changed_at ON public.results;
CREATE TRIGGER trg_results_changed_at
	BEFORE INSERT OR UPDATE ON public.results
	FOR EACH ROW EXECUTE FUNCTION public.set_changed_at();

DROP TRIGGER IF EXISTS trg_challenges_log ON public.challenges;
CREATE TRIGGER trg_challenges_log
	AFTER INSERT OR UPDATE OR DELETE ON public.challenges
	FOR EACH ROW EXECUTE FUNCTION public.log_change();

DROP TRIGGER IF EXISTS trg_results_log ON public.results;
CREATE TRIGGER trg_results_log
	AFTER INSERT OR UPDATE OR DELETE ON public.results
	FOR EACH ROW EXECUTE FUNCTION public.log_change();


/* ---------------- Access (Row Level Security) ---------------- */

ALTER TABLE public.challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_log ENABLE ROW LEVEL SECURITY;

-- Explicit grants, because newer Supabase projects no longer expose new tables to the API automatically
GRANT SELECT ON public.challenges, public.results TO anon, authenticated;
GRANT INSERT, UPDATE ON public.challenges, public.results TO authenticated;
GRANT SELECT ON public.change_log TO authenticated;
-- No DELETE grant: the app never deletes, so a mistake cannot wipe a season
REVOKE DELETE ON public.challenges, public.results FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.change_log FROM anon, authenticated;

-- Leaderboard is public, like data.json in the public repo today
DROP POLICY IF EXISTS challenges_read ON public.challenges;
CREATE POLICY challenges_read ON public.challenges FOR SELECT TO anon, authenticated USING (TRUE);

DROP POLICY IF EXISTS results_read ON public.results;
CREATE POLICY results_read ON public.results FOR SELECT TO anon, authenticated USING (TRUE);

-- Only the shared group login may write (sign-ups must be disabled in Supabase, see README)
DROP POLICY IF EXISTS challenges_insert ON public.challenges;
CREATE POLICY challenges_insert ON public.challenges FOR INSERT TO authenticated WITH CHECK (TRUE);

DROP POLICY IF EXISTS challenges_update ON public.challenges;
CREATE POLICY challenges_update ON public.challenges FOR UPDATE TO authenticated USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS results_insert ON public.results;
CREATE POLICY results_insert ON public.results FOR INSERT TO authenticated WITH CHECK (TRUE);

DROP POLICY IF EXISTS results_update ON public.results;
CREATE POLICY results_update ON public.results FOR UPDATE TO authenticated USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS change_log_read ON public.change_log;
CREATE POLICY change_log_read ON public.change_log FOR SELECT TO authenticated USING (TRUE);
