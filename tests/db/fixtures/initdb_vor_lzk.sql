-- initDB-Stapel aus server.js vor der LZK-Umstellung (99980fa^) - fuer t_lzk_migration.mjs.
-- Nicht aendern: er steht fuer die Datenbank, wie sie vor dem Upgrade auf dem Server war.

    CREATE TABLE IF NOT EXISTS users (
      id           SERIAL PRIMARY KEY,
      username     TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      klasse       TEXT NOT NULL,
      role         TEXT NOT NULL DEFAULT 'student',
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS progress (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key        TEXT NOT NULL,
      value      TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, key)
    );
    CREATE TABLE IF NOT EXISTS session (
      sid    TEXT PRIMARY KEY,
      sess   JSON NOT NULL,
      expire TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS korrektur (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      gruppe     TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'ausstehend',
      notiz      TEXT DEFAULT '',
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      admin_id   INTEGER REFERENCES users(id),
      lerntheke  TEXT NOT NULL DEFAULT '',
      UNIQUE(user_id, gruppe)
    );
    CREATE INDEX IF NOT EXISTS idx_progress_user ON progress(user_id);
    CREATE INDEX IF NOT EXISTS idx_session_expire ON session(expire);
    CREATE INDEX IF NOT EXISTS idx_korrektur_user ON korrektur(user_id);
    -- Migrate old class-based lzk table to per-user lzk table
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lzk' AND column_name='klasse') THEN
        DROP TABLE lzk;
      END IF;
    END $$;
    CREATE TABLE IF NOT EXISTS lzk (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      lerntheke  TEXT NOT NULL,
      typ        TEXT NOT NULL,
      datum      DATE,
      status     TEXT NOT NULL DEFAULT 'ausstehend',
      pokale     INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      admin_id   INTEGER REFERENCES users(id),
      UNIQUE(user_id, lerntheke, typ)
    );
    CREATE INDEX IF NOT EXISTS idx_lzk_user ON lzk(user_id);
    CREATE TABLE IF NOT EXISTS lerntheke_access (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      lerntheke  TEXT NOT NULL,
      gesperrt   BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, lerntheke)
    );
    CREATE TABLE IF NOT EXISTS active_lerntheke (
      user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      lerntheke  TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    -- Migrate: add lerntheke column if missing, then fix unique constraint
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='kurs') THEN
        ALTER TABLE users ADD COLUMN kurs VARCHAR(1) NOT NULL DEFAULT 'E';
      END IF;
    END $$;
    -- Passiv setzen (2026-08-26): Schüler:innen, die die Klasse verlassen haben o.ä., verschwinden
    -- damit aus Übersichten/Ranglisten/Klassenkameraden-Listen, bleiben aber in der Klassen-Übersicht
    -- (Nutzerverwaltung) sichtbar (dort ans Ende sortiert) und können reaktiviert werden. Login bleibt
    -- bewusst weiter möglich - das ist kein Löschen, nur ein Ausblenden.
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='aktiv') THEN
        ALTER TABLE users ADD COLUMN aktiv BOOLEAN NOT NULL DEFAULT true;
      END IF;
    END $$;
    -- Zeitpunkt des Passiv-Setzens (2026-09-04): Gegenstück zu created_at. Ohne diesen Stempel
    -- ließe sich "war damals dabei" nicht von "ist inzwischen raus" unterscheiden - die Person
    -- wäre rückwirkend aus allen Halbjahren verschwunden. NULL = aktiv.
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='passiv_seit') THEN
        ALTER TABLE users ADD COLUMN passiv_seit TIMESTAMPTZ;
      END IF;
    END $$;
    -- Super-Admin (2026-09-07): zusätzliche Stufe innerhalb von role='admin'. Nur Super-Admins
    -- dürfen Admins anlegen/löschen, andere zu Super-Admins machen, Fächer (auch fremde) setzen
    -- und Termine anderer Lernbegleitungen stornieren/verschieben. Bewusst eine eigene Spalte
    -- statt einer neuen role, damit alle bestehenden role='admin'-Prüfungen unverändert greifen.
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='super_admin') THEN
        ALTER TABLE users ADD COLUMN super_admin BOOLEAN NOT NULL DEFAULT false;
      END IF;
    END $$;
    UPDATE users SET super_admin = true
      WHERE role = 'admin' AND username IN ('admin_m1m2','admin_m3m4','admin_m5m6','admin_m7m8')
        AND super_admin = false;
    -- Altbestand: wer schon passiv ist, aber noch keinen Stempel hat, bekommt den aktuellen
    -- Zeitpunkt - damit zählt die Vergangenheit weiter und erst ab jetzt nicht mehr.
    UPDATE users SET passiv_seit = NOW() WHERE aktiv = false AND passiv_seit IS NULL;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lerntheke_access' AND column_name='kurs') THEN
        ALTER TABLE lerntheke_access ADD COLUMN kurs VARCHAR(1) DEFAULT NULL;
      END IF;
    END $$;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='korrektur' AND column_name='lerntheke') THEN
        ALTER TABLE korrektur ADD COLUMN lerntheke TEXT NOT NULL DEFAULT '';
      END IF;
    END $$;
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='korrektur_user_id_gruppe_key') THEN
        ALTER TABLE korrektur DROP CONSTRAINT korrektur_user_id_gruppe_key;
        ALTER TABLE korrektur ADD CONSTRAINT korrektur_user_id_lerntheke_gruppe_key UNIQUE(user_id, lerntheke, gruppe);
      END IF;
    END $$;
    CREATE TABLE IF NOT EXISTS talking_slots (
      id         SERIAL PRIMARY KEY,
      klasse     TEXT NOT NULL,
      datum      DATE NOT NULL,
      uhrzeit    TEXT NOT NULL DEFAULT '',
      ort        TEXT NOT NULL DEFAULT '',
      halbjahr   TEXT NOT NULL,
      admin_id   INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS talking_sessions (
      id                  SERIAL PRIMARY KEY,
      slot_id             INTEGER NOT NULL UNIQUE REFERENCES talking_slots(id) ON DELETE CASCADE,
      presenter_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      thema               TEXT NOT NULL,
      presented_status    TEXT NOT NULL DEFAULT 'ausstehend',
      admin_id            INTEGER REFERENCES users(id),
      updated_at          TIMESTAMPTZ DEFAULT NOW(),
      created_at          TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS talking_invitations (
      id                 SERIAL PRIMARY KEY,
      session_id         INTEGER NOT NULL REFERENCES talking_sessions(id) ON DELETE CASCADE,
      listener_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status             TEXT NOT NULL DEFAULT 'eingeladen',
      -- WIE ist die Person auf die Liste gekommen? Bewusst getrennt von status:
      -- der beantwortet "ist sie dabei?", das hier "hat sie dem zugestimmt?".
      -- 'selbst'     = Einladung angenommen oder Anfrage gestellt
      -- 'zugewiesen' = von der Lernbegleitung eingeteilt, wurde nie gefragt
      herkunft           TEXT NOT NULL DEFAULT 'selbst',
      -- Nur bei 'zugewiesen' relevant: wann die Person den Termin zur Kenntnis
      -- genommen hat ("Alles klar"). NULL = weiß vermutlich noch nichts davon.
      gesehen_am         TIMESTAMPTZ,
      attended_status    TEXT NOT NULL DEFAULT 'ausstehend',
      admin_id           INTEGER REFERENCES users(id),
      updated_at         TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(session_id, listener_id)
    );
    CREATE INDEX IF NOT EXISTS idx_talking_slots_klasse ON talking_slots(klasse, datum);
    CREATE INDEX IF NOT EXISTS idx_talking_sessions_presenter ON talking_sessions(presenter_id);
    CREATE INDEX IF NOT EXISTS idx_talking_invitations_listener ON talking_invitations(listener_id);
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='talking_sessions' AND column_name='pokale') THEN
        ALTER TABLE talking_sessions ADD COLUMN pokale INTEGER NOT NULL DEFAULT 0;
      END IF;
    END $$;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='talking_sessions' AND column_name='quality_emoji') THEN
        ALTER TABLE talking_sessions ADD COLUMN quality_emoji TEXT;
      END IF;
    END $$;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='talking_invitations' AND column_name='pokale') THEN
        ALTER TABLE talking_invitations ADD COLUMN pokale INTEGER NOT NULL DEFAULT 0;
      END IF;
    END $$;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='talking_invitations' AND column_name='quality_emoji') THEN
        ALTER TABLE talking_invitations ADD COLUMN quality_emoji TEXT;
      END IF;
    END $$;
    -- Migration: presented_confirmed/attended_confirmed (Boolean) -> presented_status/attended_status
    -- (Tri-State: ausstehend/erledigt/nicht_erledigt) für "nicht teilgenommen" als eigenen Zustand.
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='talking_sessions' AND column_name='presented_confirmed') THEN
        ALTER TABLE talking_sessions ADD COLUMN IF NOT EXISTS presented_status TEXT NOT NULL DEFAULT 'ausstehend';
        UPDATE talking_sessions SET presented_status = CASE WHEN presented_confirmed THEN 'erledigt' ELSE 'ausstehend' END;
        ALTER TABLE talking_sessions DROP COLUMN presented_confirmed;
      END IF;
    END $$;
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='talking_invitations' AND column_name='attended_confirmed') THEN
        ALTER TABLE talking_invitations ADD COLUMN IF NOT EXISTS attended_status TEXT NOT NULL DEFAULT 'ausstehend';
        UPDATE talking_invitations SET attended_status = CASE WHEN attended_confirmed THEN 'erledigt' ELSE 'ausstehend' END;
        ALTER TABLE talking_invitations DROP COLUMN attended_confirmed;
      END IF;
    END $$;
    -- Herkunft/Kenntnisnahme (2026-09-16). Die Nachrüstung läuft genau einmal - im
    -- IF-Zweig, bevor die Spalte existiert. Für Altbestand lässt sich die Herkunft nicht
    -- mehr sicher rekonstruieren, deshalb eine Heuristik: Einladungen an einem Fachbüro
    -- OHNE buchende Person sind so gut wie immer Zuweisungen der Lernbegleitung
    -- (Schüler:innen erzeugen presenterlose Sessions nur über Anfragen, und die gibt es
    -- erst seit wenigen Tagen). Alles andere gilt als 'selbst'.
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name='talking_invitations' AND column_name='herkunft') THEN
        ALTER TABLE talking_invitations ADD COLUMN herkunft TEXT NOT NULL DEFAULT 'selbst';
        UPDATE talking_invitations ti SET herkunft = 'zugewiesen'
          FROM talking_sessions ts JOIN talking_slots sl ON sl.id = ts.slot_id
         WHERE ts.id = ti.session_id AND ts.presenter_id IS NULL AND sl.typ = 'input';
      END IF;
    END $$;
    -- Eigener Wächter je Spalte: sonst bliebe gesehen_am aus, wenn herkunft schon da ist.
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name='talking_invitations' AND column_name='gesehen_am') THEN
        ALTER TABLE talking_invitations ADD COLUMN gesehen_am TIMESTAMPTZ;
      END IF;
    END $$;
    -- Mathe-Input (2026-08-01): talking_slots dienen jetzt auch als Input-Termine (typ='input').
    -- typ='talk' = Schüler-Vortrag (mit Pokalen), typ='input' = Angebot der Lernbegleitung, Solo-buchbar, ohne Pokale.
    -- Sichtbar heißt typ='input' seit 2026-09 überall "Fachbüro" (kurz FaBü); der gespeicherte Wert bleibt 'input'.
    -- dauer (Minuten) für Überschneidungsschutz; uhrzeit bleibt Text, wird als HH:MM interpretiert.
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='talking_slots' AND column_name='typ') THEN
        ALTER TABLE talking_slots ADD COLUMN typ TEXT NOT NULL DEFAULT 'talk';
      END IF;
    END $$;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='talking_slots' AND column_name='dauer') THEN
        ALTER TABLE talking_slots ADD COLUMN dauer INTEGER NOT NULL DEFAULT 45;
      END IF;
    END $$;
    -- Thema am Termin selbst (2026-09): ein Fachbüro lässt sich damit MIT Thema ausschreiben,
    -- ohne dass schon jemand zugewiesen ist. Das Thema der Buchung (talking_sessions.thema)
    -- bleibt davon unberührt - es überschreibt in der Anzeige das ausgeschriebene.
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='talking_slots' AND column_name='thema') THEN
        ALTER TABLE talking_slots ADD COLUMN thema TEXT NOT NULL DEFAULT '';
      END IF;
    END $$;
    -- Ein Fachbuero laesst sich fuer weitere Anmeldungen schliessen (2026-09): der Termin
    -- bleibt bestehen, wer schon dabei ist behaelt ihn, aber es kommt niemand mehr dazu.
    -- Fuer alle uebrigen Schueler:innen verschwindet er damit aus dem Kalender - das ist
    -- gewollt, ein Termin ohne jede Handlungsmoeglichkeit ist fuer sie nur Rauschen.
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='talking_slots' AND column_name='geschlossen') THEN
        ALTER TABLE talking_slots ADD COLUMN geschlossen BOOLEAN NOT NULL DEFAULT false;
      END IF;
    END $$;
    -- Deadlines/Termine der Lernbegleitungen (klassenweit sichtbar im Kalender, alles Mathe = blau).
    CREATE TABLE IF NOT EXISTS math_deadlines (
      id         SERIAL PRIMARY KEY,
      klasse     TEXT NOT NULL,
      datum      DATE NOT NULL,
      titel      TEXT NOT NULL,
      admin_id   INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_math_deadlines_klasse ON math_deadlines(klasse, datum);
    -- Stations-Abschluss-Ereignisse (2026-08-04): pro erledigter Station ein Zeitstempel,
    -- damit Abschlüsse einem Halbjahr zugeordnet werden können (nur ab jetzt, kein Altbestand).
    CREATE TABLE IF NOT EXISTS station_events (
      id           SERIAL PRIMARY KEY,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      progress_key TEXT NOT NULL,
      station_id   INTEGER NOT NULL,
      completed_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, progress_key, station_id)
    );
    CREATE INDEX IF NOT EXISTS idx_station_events_user ON station_events(user_id, progress_key);
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='must_change_password') THEN
        ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
      END IF;
    END $$;
    -- Fächer (2026-08-06): Mathe/Englisch/Deutsch können jeweils eigene Talks+Input anbieten.
    -- Global (nicht klasse-gebunden) - Farbe/Name sind fest, Ort/Dauer/Pflicht-Mindestanzahl admin-editierbar.
    CREATE TABLE IF NOT EXISTS subjects (
      id                     SERIAL PRIMARY KEY,
      key                    TEXT NOT NULL UNIQUE,
      name                   TEXT NOT NULL,
      color                  TEXT NOT NULL,
      color_bg               TEXT NOT NULL DEFAULT '',
      default_ort            TEXT NOT NULL DEFAULT '',
      default_dauer          INTEGER NOT NULL DEFAULT 45,
      pflicht_praesentieren  INTEGER NOT NULL DEFAULT 1,
      pflicht_zuhoeren       INTEGER NOT NULL DEFAULT 2,
      optional_praesentieren INTEGER NOT NULL DEFAULT 2,
      optional_zuhoeren      INTEGER NOT NULL DEFAULT 1,
      created_at             TIMESTAMPTZ DEFAULT NOW()
    );
    -- Freiwillige Zusatz-Plätze je Fach (2026-09-04): wie viele Talks/Zuhör-Termine über die
    -- Pflicht hinaus angeboten werden. Defaults 2/1 bilden exakt das bisher hartcodierte
    -- Frontend-Verhalten ab (Präsentieren: 1 Pflicht + 2 Zusatz, Zuhören: 2 Pflicht + 1 Zusatz).
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='subjects' AND column_name='optional_praesentieren') THEN
        ALTER TABLE subjects ADD COLUMN optional_praesentieren INTEGER NOT NULL DEFAULT 2;
      END IF;
    END $$;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='subjects' AND column_name='optional_zuhoeren') THEN
        ALTER TABLE subjects ADD COLUMN optional_zuhoeren INTEGER NOT NULL DEFAULT 1;
      END IF;
    END $$;
    -- Vorgaben je Fach UND Halbjahr (2026-09-04): die subjects-Spalten bleiben der Standard,
    -- hier stehen nur abweichende Halbjahre. Fehlt ein Halbjahr hier, gilt der Fach-Standard.
    CREATE TABLE IF NOT EXISTS subject_halbjahr_targets (
      subject_id             INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      halbjahr               TEXT NOT NULL,
      pflicht_praesentieren  INTEGER NOT NULL DEFAULT 1,
      pflicht_zuhoeren       INTEGER NOT NULL DEFAULT 2,
      optional_praesentieren INTEGER NOT NULL DEFAULT 2,
      optional_zuhoeren      INTEGER NOT NULL DEFAULT 1,
      updated_at             TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (subject_id, halbjahr)
    );
    INSERT INTO subjects (key, name, color, color_bg, default_ort, default_dauer) VALUES
      ('mathe',    'Mathe',    '#2563eb', '#eff6ff', 'Mathe-Fachbüro',    45),
      ('englisch', 'Englisch', '#eab308', '#fefce8', 'Englisch-Fachbüro', 45),
      ('deutsch',  'Deutsch',  '#dc2626', '#fef2f2', 'Deutsch-Fachbüro',  45)
    ON CONFLICT (key) DO NOTHING;
    -- Lernberatung (2026-09): kein echtes Fach, sondern ein Platz im Fach-Dropdown fuer
    -- Termine, die nur einzelne Schüler:innen betreffen. nur_zugewiesen steuert alles
    -- Weitere: solche Termine werden nirgends als Angebot ausgespielt, sondern nur denen
    -- gezeigt, die ihnen zugeordnet sind - auch nicht auf der öffentlichen Wochenübersicht.
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='subjects' AND column_name='nur_zugewiesen') THEN
        ALTER TABLE subjects ADD COLUMN nur_zugewiesen BOOLEAN NOT NULL DEFAULT false;
      END IF;
    END $$;
    INSERT INTO subjects (key, name, color, color_bg, default_ort, default_dauer, nur_zugewiesen) VALUES
      ('lernberatung', 'Lernberatung', '#7c3aed', '#f5f3ff', '', 45, true)
    ON CONFLICT (key) DO NOTHING;
    -- Bestehende Installationen hatten default_ort noch leer (Seed lief bereits vor dieser
    -- Änderung) - einmalig nachziehen, aber admin-editierte Werte nicht überschreiben.
    UPDATE subjects SET default_ort='Mathe-Fachbüro'    WHERE key='mathe'    AND default_ort='';
    UPDATE subjects SET default_ort='Englisch-Fachbüro' WHERE key='englisch' AND default_ort='';
    UPDATE subjects SET default_ort='Deutsch-Fachbüro'  WHERE key='deutsch'  AND default_ort='';
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='talking_slots' AND column_name='subject_id') THEN
        ALTER TABLE talking_slots ADD COLUMN subject_id INTEGER REFERENCES subjects(id);
      END IF;
    END $$;
    UPDATE talking_slots SET subject_id=(SELECT id FROM subjects WHERE key='mathe') WHERE subject_id IS NULL;
    -- Admin-erstellte Input-Sessions ohne festen "Presenter" (nur zugewiesene Teilnehmer:innen) - siehe [[project_talking_sessions]].
    ALTER TABLE talking_sessions ALTER COLUMN presenter_id DROP NOT NULL;
    -- Persönliche Fach-Präferenz je Admin (2026-08-26): das gewählte Fach steht in Übersichten immer
    -- zuerst (z.B. Halbjahr-Übersicht) - NULL = keine Präferenz, natürliche Fach-Reihenfolge.
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='default_subject_id') THEN
        ALTER TABLE users ADD COLUMN default_subject_id INTEGER REFERENCES subjects(id);
      END IF;
    END $$;
    -- Kurs (E/G) pro Fach (2026-08-26): Mathe/Englisch/Deutsch bekommen je Schüler:in einen
    -- eigenen Kurs-Wert. Mathe bleibt zusätzlich in users.kurs gespiegelt, da die bestehende
    -- Lerntheken-Default-Logik (Aufbau-Gruppe etc.) ausschließlich von dort liest - siehe
    -- /api/access, /api/admin/students u.a. Englisch/Deutsch haben aktuell keine Lerntheken,
    -- der Kurs-Wert wird dort nur gespeichert (Grundlage für spätere Differenzierung).
    -- Wunschliste (2026-09-23) -- steht bewusst HINTER subjects und talking_slots:
    -- die Fremdschluessel zeigen dorthin, und initDB laeuft als EIN Stapel.
    -- Schüler:innen tragen Themen ein, die sie sich als
    -- Fachbüro wünschen, und stimmen bei fremden Wünschen mit "ich auch" zu.
    -- slot_id haelt fest, welcher Termin daraus geworden ist (Status 'geplant').
    CREATE TABLE IF NOT EXISTS wunsch (
      id            SERIAL PRIMARY KEY,
      klasse        TEXT NOT NULL,
      subject_id    INTEGER REFERENCES subjects(id),
      titel         TEXT NOT NULL,
      beschreibung  TEXT NOT NULL DEFAULT '',
      user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
      status        TEXT NOT NULL DEFAULT 'offen',   -- offen | geplant | erledigt | abgelehnt
      notiz         TEXT NOT NULL DEFAULT '',        -- Begründung bei abgelehnt
      slot_id       INTEGER REFERENCES talking_slots(id) ON DELETE SET NULL,
      admin_id      INTEGER REFERENCES users(id),
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    );
    -- Gemeinsamer Primärschlüssel: dieselbe Person kann pro Wunsch nur einmal
    -- zustimmen - das haelt die Datenbank fest, nicht der Anwendungscode.
    CREATE TABLE IF NOT EXISTS wunsch_interesse (
      wunsch_id  INTEGER NOT NULL REFERENCES wunsch(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (wunsch_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS user_subject_kurs (
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      kurs       VARCHAR(1) NOT NULL DEFAULT 'E',
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (user_id, subject_id)
    );
    INSERT INTO user_subject_kurs (user_id, subject_id, kurs)
      SELECT u.id, (SELECT id FROM subjects WHERE key='mathe'), u.kurs
      FROM users u WHERE u.role='student'
      ON CONFLICT (user_id, subject_id) DO NOTHING;
