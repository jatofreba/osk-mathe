require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const bcrypt = require('bcrypt');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ── PostgreSQL Pool ───────────────────────────────────────────────────────────
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'test123',
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'lerntheke'
});

// ── Schema ────────────────────────────────────────────────────────────────────
async function initDB() {
  await pool.query(`
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
    -- Hier stand frueher: DROP TABLE lzk, falls die Tabelle noch klassenbasiert war
    -- (Spalte "klasse"). Die Umstellung ist lange durch, die Zeile lief aber bei JEDEM
    -- Start weiter - jede kuenftige Spalte "klasse" an lzk haette alle LZK geloescht.
    -- Entfernt (2026-09-24). lzk bekommt nie wieder eine Spalte dieses Namens.
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
    -- LZK fachuebergreifend (2026-09-24). Bisher gab es LZK nur zu Mathe-Lerntheken
    -- (lerntheke + Basis/Aufbau). Jetzt auch ohne Lerntheke, fachgebunden, mit Thema und
    -- als Anfrage. Alles additiv: bestehende Eintraege werden Mathe, sonst bleibt alles.
    -- lerntheke darf leer (NULL) sein = freie LZK (Deutsch, Englisch, ...). Postgres setzt
    -- NULL in UNIQUE nicht gleich - UNIQUE(user_id, lerntheke, typ) bindet damit weiter
    -- nur die Lerntheken-LZK, freie kann es beliebig viele geben.
    ALTER TABLE lzk ALTER COLUMN lerntheke DROP NOT NULL;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lzk' AND column_name='subject_id') THEN
        ALTER TABLE lzk ADD COLUMN subject_id INTEGER REFERENCES subjects(id);
      END IF;
    END $$;
    UPDATE lzk SET subject_id=(SELECT id FROM subjects WHERE key='mathe') WHERE subject_id IS NULL;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lzk' AND column_name='thema') THEN
        ALTER TABLE lzk ADD COLUMN thema TEXT NOT NULL DEFAULT '';
      END IF;
    END $$;
    -- anfrage: NULL = fester Termin, 'offen' = von der Schueler:in angefragt, 'abgelehnt'.
    -- Bewusst ein eigenes Feld statt eines weiteren status-Werts: status wird an vielen
    -- Stellen als ausstehend/bestanden/nicht_bestanden ausgewertet.
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lzk' AND column_name='anfrage') THEN
        ALTER TABLE lzk ADD COLUMN anfrage TEXT;
      END IF;
    END $$;
    -- herkunft: 'selbst' (von der Schueler:in) oder 'lernbegleitung'.
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lzk' AND column_name='herkunft') THEN
        ALTER TABLE lzk ADD COLUMN herkunft TEXT NOT NULL DEFAULT 'selbst';
      END IF;
    END $$;
    CREATE INDEX IF NOT EXISTS idx_lzk_subject ON lzk(subject_id);
    -- lzk_modus ist seit 2026-09-24 OHNE Wirkung: Schueler:innen fragen LZK-Termine
    -- immer an und legen sie nie selbst fest (Nutzervorgabe). Die Spalte bleibt stehen,
    -- weil sie schon angelegt ist - geloescht wird im Schema nichts.
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='subjects' AND column_name='lzk_modus') THEN
        ALTER TABLE subjects ADD COLUMN lzk_modus TEXT NOT NULL DEFAULT 'direkt';
      END IF;
    END $$;
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
  `);

  // Seed admin accounts (only if they don't exist)
  const admins = [
    { username: 'admin_m1m2', klasse: 'M1M2', password: 'admin123', mustChange: false },
    { username: 'admin_m3m4', klasse: 'M3M4', password: 'admin123', mustChange: false },
    { username: 'admin_m5m6', klasse: 'M5M6', password: 'admin123', mustChange: false },
    { username: 'admin_m7m8', klasse: 'M7M8', password: 'admin123', mustChange: false },
    { username: 'koek', klasse: 'M3M4', password: 'test', mustChange: true },
    { username: 'herf', klasse: 'M3M4', password: 'test', mustChange: true },
  ];
  for (const a of admins) {
    const hash = await bcrypt.hash(a.password, 10);
    await pool.query(`
      INSERT INTO users (username, password_hash, klasse, role, must_change_password)
      VALUES ($1, $2, $3, 'admin', $4)
      ON CONFLICT (username) DO NOTHING
    `, [a.username, hash, a.klasse, a.mustChange]);
  }
  console.log('✓ Datenbank bereit');

  // Auto-sync stations from JSON files into HTML on every startup
  await syncAllStations();
}

async function syncAllStations() {
  const dir = path.join(__dirname, 'public', 'lerntheken', 'stations');
  if (!fs.existsSync(dir)) return;
  for (const lernthekeId of fs.readdirSync(dir)) {
    const data = readStationsDir(lernthekeId);
    if (!data) continue;
    const htmlPath = path.join(__dirname, 'public', 'lerntheken', `${lernthekeId}.html`);
    if (!fs.existsSync(htmlPath)) continue;
    try {
      const maxId = data.stations.reduce((m, s) => Math.max(m, s.id), -1);
      const meta    = Array(maxId + 1).fill(null);
      const content = Array(maxId + 1).fill(null);
      data.stations.forEach(s => {
        const { task_html, sol_html, ...m } = s;
        meta[s.id]    = m;
        content[s.id] = { task_html: task_html || '', sol_html: sol_html || '', hilfen: s.hilfen || [] };
      });
      const groups = JSON.parse(JSON.stringify(data.groups));
      Object.keys(groups).forEach(g => {
        groups[g].total = data.stations.filter(s => s.group === g).length;
      });
      let html = fs.readFileSync(htmlPath, 'utf8');
      html = replaceJsConstant(html, 'TOTAL',   String(meta.length));
      html = replaceJsConstant(html, 'GROUPS',  JSON.stringify(groups));
      html = replaceJsConstant(html, 'META',    JSON.stringify(meta));
      html = replaceJsConstant(html, 'CONTENT', '[]');
      if (data.hilfen && data.hilfen.length)
        html = replaceJsConstant(html, 'HILFEN', JSON.stringify(data.hilfen));
      fs.writeFileSync(htmlPath, html, 'utf8');

      // Orphan cleanup
      const ltKey = extractJSValue(html, 'KEY');
      if (ltKey) {
        const existingIds = new Set(data.stations.map(s => s.id));
        const users = await pool.query(`SELECT user_id, value FROM progress WHERE key=$1`, [ltKey]);
        for (const row of users.rows) {
          try {
            const arr = JSON.parse(row.value);
            if (!Array.isArray(arr)) continue;
            const filtered = arr.filter(id => existingIds.has(Number(id)));
            if (filtered.length !== arr.length)
              await pool.query(`UPDATE progress SET value=$1, updated_at=NOW() WHERE user_id=$2 AND key=$3`,
                [JSON.stringify(filtered), row.user_id, ltKey]);
          } catch {}
        }
        const inputs = await pool.query(`SELECT user_id, key FROM progress WHERE key LIKE 'lerntheke_inputs_%'`);
        for (const row of inputs.rows) {
          const stId = parseInt(row.key.replace('lerntheke_inputs_', ''), 10);
          if (!isNaN(stId) && !existingIds.has(stId))
            await pool.query(`DELETE FROM progress WHERE user_id=$1 AND key=$2`, [row.user_id, row.key]);
        }
      }
      delete ltMetaCache[lernthekeId];
      console.log(`✓ Sync: ${lernthekeId} (${data.stations.length} Stationen)`);
    } catch(e) { console.warn(`⚠ Sync fehlgeschlagen für ${lernthekeId}: ${e.message}`); }
  }
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
const { execSync } = require('child_process');
const GIT_HASH = (() => { try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return Date.now(); } })();

app.get('/api/version', (req, res) => res.json({ hash: GIT_HASH, ts: new Date().toISOString() }));

// Inject git hash as cache-buster into lerntheke HTML files (must be before static middleware)
app.get('/lerntheken/:file.html', (req, res) => {
  const filePath = path.join(__dirname, 'public', 'lerntheken', req.params.file + '.html');
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  let html = fs.readFileSync(filePath, 'utf8');
  html = html.replace(/lerntheke\.js\?v=[^"']*/g, `lerntheke.js?v=${GIT_HASH}`);
  html = html.replace(/lerntheke\.css\?v=[^"']*/g, `lerntheke.css?v=${GIT_HASH}`);
  res.setHeader('Cache-Control', 'no-cache');
  res.send(html);
});

app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store, must-revalidate');
  }
}));
app.use(session({
  store: new pgSession({ pool, tableName: 'session' }),
  secret: process.env.SESSION_SECRET || 'bitte-aendern-' + Math.random(),
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'strict' }
}));

// ── Auth helpers ──────────────────────────────────────────────────────────────
const requireLogin = (req, res, next) =>
  req.session.userId ? next() : res.status(401).json({ error: 'Nicht angemeldet' });

const requireAdmin = (req, res, next) =>
  req.session.role === 'admin' ? next() : res.status(403).json({ error: 'Kein Zugriff' });

// Super-Admin-Status bewusst frisch aus der DB lesen statt aus der Session: sonst müssten
// bestehende Sessions (und frisch beförderte Admins) sich erst neu einloggen.
async function isSuperAdmin(userId) {
  if (!userId) return false;
  try {
    const r = await pool.query('SELECT super_admin FROM users WHERE id=$1', [userId]);
    return !!(r.rows[0] && r.rows[0].super_admin);
  } catch { return false; }
}

const requireSuperAdmin = async (req, res, next) => {
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Kein Zugriff' });
  if (await isSuperAdmin(req.session.userId)) return next();
  return res.status(403).json({ error: 'Nur Super-Admins dürfen das' });
};

// Termine gehören der eingetragenen Lernbegleitung (talking_slots.admin_id). Normale Admins
// dürfen nur ihre eigenen ändern/stornieren, Super-Admins alle des Tandems.
async function mayManageSlot(req, slotId) {
  const r = await pool.query('SELECT admin_id FROM talking_slots WHERE id=$1 AND klasse=$2',
    [slotId, req.session.klasse]);
  if (!r.rows.length) return { ok: false, status: 404, error: 'Nicht gefunden' };
  // adminId = zuständige Lernbegleitung des Slots. Wird von der Terminkonflikt-Prüfung
  // gebraucht, damit dort gegen DIESE Person geprüft wird und nicht gegen die aufrufende
  // (ein Super-Admin darf fremde Termine verschieben).
  const adminId = r.rows[0].admin_id;
  if (adminId === req.session.userId) return { ok: true, adminId };
  if (await isSuperAdmin(req.session.userId)) return { ok: true, adminId };
  return { ok: false, status: 403, error: 'Dieser Termin gehört einer anderen Lernbegleitung - nur Super-Admins dürfen ihn ändern' };
}

// Vorgegebene Auswahl für die Qualitäts-Bewertung von Mathe-Talks (Admin)
const TALKING_QUALITY_EMOJIS = ['🤩','🌟','👍','🙂','🤔','💡','🎯','🔥'];
// Tri-State statt Boolean, damit "nicht teilgenommen" von "noch nicht bewertet" unterscheidbar ist.
const TALKING_STATUS_VALUES = ['ausstehend', 'erledigt', 'nicht_erledigt'];

// Pokale-Gesamtcount für Mathe-Talks: Pflicht (1. Vortrag, erste 2 Zuhör-Termine
// je Halbjahr) zählt immer zum Max, auch wenn noch nicht wahrgenommen. Zusatz/Bonus
// (beliebig viele weitere Vorträge/Zuhör-Termine) zählt nur zum Max, wenn tatsächlich
// angemeldet. Von /api/talking-sessions/mine und /api/leaderboard gemeinsam genutzt,
// damit "Meine Pokale" und die Rangliste nie auseinanderlaufen.
// targetsFor: (halbjahr) => { pflichtP, pflichtZ } - seit 2026-09-04 können die Vorgaben je
// Halbjahr abweichen (subject_halbjahr_targets), deshalb keine festen Zahlen mehr.
function computeTalkingTrophies(halbjahre, presenting, listening, targetsFor) {
  const resolve = typeof targetsFor === 'function' ? targetsFor : () => ({});
  let earned = 0, max = 0;
  const byHalbjahr = {};
  halbjahre.forEach(hj => {
    const t = resolve(hj) || {};
    const pflichtP = t.pflichtP == null ? 1 : t.pflichtP;
    const pflichtZ = t.pflichtZ == null ? 2 : t.pflichtZ;
    let hjEarned = 0, hjMax = 0;
    const myPresenting = presenting.filter(s => s.halbjahr === hj).sort((a, b) => new Date(a.datum) - new Date(b.datum));
    const myListening = listening.filter(i => i.halbjahr === hj).sort((a, b) => new Date(a.datum) - new Date(b.datum));
    for (let i = 0; i < pflichtP; i++) { // Pflicht-Vorträge zählen immer zum Max, auch wenn noch nicht wahrgenommen
      hjMax += 3;
      const s = myPresenting[i];
      if (s && s.presentedStatus === 'erledigt') hjEarned += s.pokale || 0;
    }
    myPresenting.slice(pflichtP).forEach(s => { // beliebig viele Zusatz-Vorträge, nur wenn angemeldet
      hjMax += 3;
      if (s.presentedStatus === 'erledigt') hjEarned += s.pokale || 0;
    });
    for (let i = 0; i < pflichtZ; i++) { // Pflicht-Zuhör-Termine zählen immer zum Max
      hjMax += 2;
      const iv = myListening[i];
      if (iv && iv.attendedStatus === 'erledigt') hjEarned += iv.pokale || 0;
    }
    myListening.slice(pflichtZ).forEach(iv => {
      hjMax += 2;
      if (iv.attendedStatus === 'erledigt') hjEarned += iv.pokale || 0;
    });
    byHalbjahr[hj] = { earned: hjEarned, max: hjMax };
    earned += hjEarned; max += hjMax;
  });
  return { earned, max, byHalbjahr };
}

// ── Überschneidungsschutz für Mathe-Termine (Talks + Input) ────────────────────
// uhrzeit wird als "HH:MM" interpretiert. Nicht parsebare Zeiten (alte Freitext-Slots)
// werden vom Konflikt-Check ausgenommen (Zeit unbekannt -> nicht blockieren).
function parseUhrzeitMin(uhrzeit) {
  const m = String(uhrzeit || '').match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = parseInt(m[1], 10), min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// Alle Zeitfenster, die eine Person schon belegt: eigene Buchungen (Talk halten / Input)
// + Zuhör-Einladungen mit Status 'eingeladen' ODER 'angenommen' - eine nur eingeladene, noch
// unbeantwortete Person soll trotzdem nirgends sonst zugewiesen werden können. Eine offene
// Anfrage ('angefragt') belegt dagegen NICHTS: erst die Zusage der Lernbegleitung macht daraus
// einen Termin, vorher soll sie andere Buchungen nicht blockieren.
// datum als YYYY-MM-DD-Text (to_char) gegen Zeitzonen-Verschiebung.
async function studentOccupiedIntervals(uid, excludeSlotId) {
  const r = await pool.query(`
    SELECT sl.id AS slot_id, to_char(sl.datum,'YYYY-MM-DD') AS datum, sl.uhrzeit, sl.dauer
    FROM talking_sessions ts JOIN talking_slots sl ON sl.id = ts.slot_id
    WHERE ts.presenter_id = $1
    UNION
    SELECT sl.id AS slot_id, to_char(sl.datum,'YYYY-MM-DD') AS datum, sl.uhrzeit, sl.dauer
    FROM talking_invitations ti
    JOIN talking_sessions ts ON ts.id = ti.session_id
    JOIN talking_slots sl ON sl.id = ts.slot_id
    WHERE ti.listener_id = $1 AND ti.status IN ('eingeladen','angenommen')
  `, [uid]);
  return r.rows
    .filter(row => row.slot_id !== excludeSlotId)
    .map(row => ({ datum: row.datum, start: parseUhrzeitMin(row.uhrzeit), dauer: row.dauer || 45 }))
    .filter(row => row.start !== null);
}

// true, wenn der Slot mit einem bereits belegten Zeitfenster der Person kollidiert.
// Slots ohne parsebare Uhrzeit lösen nie einen Konflikt aus.
async function hasScheduleConflict(uid, slotId) {
  const t = await pool.query(
    `SELECT to_char(datum,'YYYY-MM-DD') AS datum, uhrzeit, dauer FROM talking_slots WHERE id=$1`, [slotId]);
  if (!t.rows.length) return false;
  const start = parseUhrzeitMin(t.rows[0].uhrzeit);
  if (start === null) return false;
  const dauer = t.rows[0].dauer || 45;
  const datum = t.rows[0].datum;
  const occ = await studentOccupiedIntervals(uid, slotId);
  return occ.some(o => o.datum === datum && start < o.start + o.dauer && o.start < start + dauer);
}

// Räumt eine Session weg, an der niemand mehr hängt: keine vortragende Person und keine
// eingetragene Person. Sonst bliebe z.B. nach einer abgelehnten Anfrage eine leere Session
// stehen und der Termin sähe für alle "gebucht" aus, obwohl niemand ihn hat.
async function dropEmptySession(sessionId) {
  if (!sessionId) return;
  await pool.query(
    `DELETE FROM talking_sessions ts
      WHERE ts.id=$1 AND ts.presenter_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM talking_invitations ti WHERE ti.session_id = ts.id)`,
    [sessionId]
  );
}

// Weist einer bestehenden Session mehrere Schüler:innen zu (Admin-Zuweisung bei Input, seit 2026-08-06).
// Prüft je Person auf Terminkonflikt (global über alle Fächer/Typen) und gibt zurück, wer angenommen wurde
// bzw. wegen Konflikt ausgelassen wurde (Person + Grund) - für Feedback im Admin-UI.
async function assignStudentsToSlot(klasse, slotId, studentIds) {
  const ids = [...new Set((Array.isArray(studentIds) ? studentIds : []).map(Number))].filter(Boolean);
  const validStudents = ids.length ? await pool.query(
    'SELECT id, username FROM users WHERE id = ANY($1) AND role=$2 AND klasse=$3',
    [ids, 'student', klasse]
  ) : { rows: [] };
  const byId = {};
  validStudents.rows.forEach(u => { byId[u.id] = u.username; });
  const conflicts = [];
  const okIds = [];
  for (const id of ids) {
    if (!byId[id]) continue; // ungültige/fremde ID wird stillschweigend übersprungen
    if (await hasScheduleConflict(id, slotId)) {
      conflicts.push({ userId: id, username: byId[id], reason: 'Zeitkonflikt: bereits ein anderer Termin zu dieser Uhrzeit' });
    } else {
      okIds.push(id);
    }
  }
  return { okIds, conflicts };
}

// Schuljahr 01.08.-31.07., Format "<StartJJ><EndJJ>_<1|2>" (Aug-Jan -> _1, Feb-Jul -> _2).
// Server-Pendant zu currentHalbjahrGuess() im Frontend. Argument: Date oder 'YYYY-MM-DD'.
function halbjahrForDate(d) {
  const dt = (d instanceof Date) ? d : new Date(String(d) + 'T00:00:00');
  if (isNaN(dt)) return null;
  const m = dt.getMonth() + 1, y = dt.getFullYear();
  let startYear, sem;
  if (m >= 8) { startYear = y; sem = 1; }
  else if (m === 1) { startYear = y - 1; sem = 1; }
  else { startYear = y - 1; sem = 2; }
  return String(startYear).slice(-2) + String(startYear + 1).slice(-2) + '_' + sem;
}

// Ein Halbjahr zählt für eine Person nur, wenn ihr Account damals schon existierte UND noch
// nicht passiv gesetzt war (2026-09-04). Das Format "<StartJJ><EndJJ>_<1|2>" sortiert
// lexikografisch korrekt ("2526_2" < "2627_1" < "2627_2"), deshalb reichen String-Vergleiche.
// Das Halbjahr des Passiv-Setzens zählt noch mit - erst ab dem Folgehalbjahr ist Schluss.
function halbjahrCountsForUser(hj, createdAt, passivSeit) {
  if (!hj) return false;
  const first = halbjahrForDate(createdAt);
  if (first && hj < first) return false;
  const last = halbjahrForDate(passivSeit);
  if (last && hj > last) return false;
  return true;
}

// Vorgaben je Fach+Halbjahr auflösen: Zeile aus subject_halbjahr_targets, sonst Fach-Standard.
// `overrides` = Zeilen aus subject_halbjahr_targets (subject_id, halbjahr, ...).
function buildTargetsResolver(subjectRow, overrides) {
  const byHj = {};
  (overrides || []).forEach(o => {
    if (Number(o.subject_id) !== Number(subjectRow.id)) return;
    byHj[o.halbjahr] = { pflichtP: o.pflicht_praesentieren, pflichtZ: o.pflicht_zuhoeren };
  });
  const std = { pflichtP: subjectRow.pflichtP, pflichtZ: subjectRow.pflichtZ };
  return (hj) => byHj[hj] || std;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const r = await pool.query('SELECT * FROM users WHERE username=$1', [(username||'').trim().toLowerCase()]);
    const user = r.rows[0];
    if (!user || !await bcrypt.compare(password||'', user.password_hash))
      return res.status(401).json({ error: 'Benutzername oder Passwort falsch' });
    Object.assign(req.session, {
      userId: user.id, username: user.username,
      klasse: user.klasse, role: user.role
    });
    res.json({ ok: true, userId: user.id, username: user.username, klasse: user.klasse, role: user.role, mustChangePassword: user.must_change_password, defaultSubjectId: user.default_subject_id, superAdmin: !!user.super_admin });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', async (req, res) => {
  if (!req.session.userId) return res.json({ loggedIn: false });
  const kr = await pool.query('SELECT kurs, default_subject_id AS "defaultSubjectId", super_admin AS "superAdmin" FROM users WHERE id=$1', [req.session.userId]).catch(() => ({ rows: [] }));
  // Kursung je Fach - seit dem Fächer-System hat jede Person pro Fach einen eigenen
  // E/G-Wert. users.kurs bleibt der gespiegelte MATHE-Wert (davon lebt die
  // Lerntheken-Logik) und wird weiterhin als `kurs` mitgeliefert.
  const skr = await pool.query(`
    SELECT s.key, usk.kurs FROM user_subject_kurs usk JOIN subjects s ON s.id = usk.subject_id
    WHERE usk.user_id = $1
  `, [req.session.userId]).catch(() => ({ rows: [] }));
  const subjectKurs = {};
  skr.rows.forEach(r => { subjectKurs[r.key] = r.kurs; });
  res.json({
    loggedIn: true, userId: req.session.userId,
    username: req.session.username, klasse: req.session.klasse, role: req.session.role,
    kurs: kr.rows[0]?.kurs || 'E',
    subjectKurs,
    defaultSubjectId: kr.rows[0]?.defaultSubjectId ?? null,
    superAdmin: !!kr.rows[0]?.superAdmin
  });
});

// Admin wählt ihr/sein "Standard-Fach" - steht danach in Übersichten (Halbjahr-Übersicht etc.) zuerst.
// Nur Super-Admins wählen ihr Fach selbst; bei normalen Admins legt es ein Super-Admin fest.
app.post('/api/set-default-subject', requireSuperAdmin, async (req, res) => {
  try {
    const { subjectId } = req.body;
    if (subjectId != null) {
      const check = await pool.query('SELECT id FROM subjects WHERE id=$1', [subjectId]);
      if (!check.rows.length) return res.status(400).json({ error: 'Ungültiges Fach' });
    }
    await pool.query('UPDATE users SET default_subject_id=$1 WHERE id=$2', [subjectId ?? null, req.session.userId]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

app.post('/api/change-password', requireLogin, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6)
      return res.status(400).json({ error: 'Passwort mind. 6 Zeichen' });
    const r = await pool.query('SELECT * FROM users WHERE id=$1', [req.session.userId]);
    const user = r.rows[0];
    if (!await bcrypt.compare(oldPassword||'', user.password_hash))
      return res.status(401).json({ error: 'Altes Passwort falsch' });
    await pool.query('UPDATE users SET password_hash=$1, must_change_password=FALSE WHERE id=$2',
      [await bcrypt.hash(newPassword, 10), req.session.userId]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// ── Progress ──────────────────────────────────────────────────────────────────
app.get('/api/progress', requireLogin, async (req, res) => {
  try {
    const r = await pool.query('SELECT key, value FROM progress WHERE user_id=$1', [req.session.userId]);
    const out = {};
    r.rows.forEach(row => { out[row.key] = row.value; });
    res.json(out);
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

app.post('/api/progress', requireLogin, async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: 'key fehlt' });
    const uid = req.session.userId;
    // Nur echte Stations-Done-Sets tracken: Wert ist ein Array, kein _abgabe_- und kein _iN-Key
    // (spiegelt den Filter aus /api/leaderboard).
    const isDoneSet = /^\[/.test(String(value).trim()) && !key.includes('_abgabe_') && !/_i\d+$/.test(key);
    let oldIds = [];
    if (isDoneSet) {
      const prev = await pool.query('SELECT value FROM progress WHERE user_id=$1 AND key=$2', [uid, key]);
      if (prev.rows.length) { try { const a = JSON.parse(prev.rows[0].value); if (Array.isArray(a)) oldIds = a; } catch {} }
    }
    await pool.query(`
      INSERT INTO progress (user_id, key, value, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (user_id, key) DO UPDATE
      SET value=$3, updated_at=NOW()
    `, [uid, key, String(value)]);
    // Neu hinzugekommene Stationen mit Zeitstempel protokollieren (best-effort - darf das
    // Speichern nie blockieren). Halbjahr wird bei der Auswertung aus completed_at abgeleitet.
    if (isDoneSet) {
      try {
        let newIds = [];
        try { const a = JSON.parse(String(value)); if (Array.isArray(a)) newIds = a; } catch {}
        const oldSet = new Set(oldIds.map(Number));
        const added = [...new Set(newIds.map(Number))].filter(id => Number.isFinite(id) && !oldSet.has(id));
        for (const sid of added) {
          await pool.query(
            `INSERT INTO station_events (user_id, progress_key, station_id) VALUES ($1,$2,$3)
             ON CONFLICT (user_id, progress_key, station_id) DO NOTHING`,
            [uid, key, sid]
          );
        }
      } catch(e) { /* Logging-Fehler bewusst ignorieren - Fortschritt ist gespeichert */ }
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// ── Stations (JSON-file-based) ────────────────────────────────────────────────
const STATIONS_DIR = path.join(__dirname, 'public', 'lerntheken', 'stations');

function parseJSONFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^﻿/, ''));
  } catch(e) {
    console.warn(`⚠ JSON-Fehler in ${filePath}: ${e.message}`);
    return null;
  }
}

function readStationsDir(lernthekeId) {
  const dir = path.join(STATIONS_DIR, lernthekeId);
  if (!fs.existsSync(dir)) return null;
  const config = parseJSONFile(path.join(dir, '_config.json'));
  if (!config) return null;
  const stations = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json') && f !== '_config.json')
    .map(f => parseJSONFile(path.join(dir, f)))
    .filter(s => s && typeof s.id === 'number')
    .sort((a, b) => a.id - b.id);
  return { ...config, stations };
}

function replaceJsConstant(html, varName, newValue) {
  // Support const, let, and var declarations
  let marker = '', idx = -1;
  for (const kw of ['const', 'let', 'var']) {
    const m = `${kw} ${varName}=`;
    const i = html.indexOf(m);
    if (i !== -1 && (idx === -1 || i < idx)) { idx = i; marker = m; }
  }
  if (idx === -1) return html;
  const after = html.slice(idx + marker.length);
  const opener = after[0];
  if (opener !== '[' && opener !== '{') {
    // number / bool – replace until ;
    const end = after.search(/[;\s]/);
    return html.slice(0, idx + marker.length) + newValue + after.slice(end);
  }
  const closer = opener === '[' ? ']' : '}';
  let depth = 0, inStr = false, strChar = '', esc = false, end = 0;
  for (let i = 0; i < after.length; i++) {
    const c = after[i];
    if (esc) { esc = false; continue; }
    if (inStr) { if (c === '\\') { esc = true; continue; } if (c === strChar) inStr = false; }
    else { if (c === '"' || c === "'") { inStr = true; strChar = c; } else if (c === opener) depth++; else if (c === closer) { depth--; if (depth === 0) { end = i; break; } } }
  }
  return html.slice(0, idx + marker.length) + newValue + after.slice(end + 1);
}

// GET /api/stations/:lerntheke – serve station data from JSON files
app.get('/api/stations/:lerntheke', requireLogin, (req, res) => {
  const data = readStationsDir(req.params.lerntheke);
  if (!data) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json(data);
});

// GET /api/stations/:lerntheke/:id – serve single station content
app.get('/api/stations/:lerntheke/:id', requireLogin, (req, res) => {
  const data = readStationsDir(req.params.lerntheke);
  if (!data) return res.status(404).json({ error: 'Nicht gefunden' });
  const st = data.stations.find(s => s.id === Number(req.params.id));
  if (!st) return res.status(404).json({ error: 'Station nicht gefunden' });
  res.json(st);
});

// POST /api/admin/sync-stations/:lerntheke – write JSON files back into HTML
app.post('/api/admin/sync-stations/:lerntheke', requireAdmin, async (req, res) => {
  try {
    const id = req.params.lerntheke;
    const data = readStationsDir(id);
    if (!data) return res.status(404).json({ error: 'Stations-Ordner nicht gefunden' });

    const htmlPath = path.join(__dirname, 'public', 'lerntheken', `${id}.html`);
    if (!fs.existsSync(htmlPath)) return res.status(404).json({ error: 'HTML-Datei nicht gefunden' });

    // Build dense arrays indexed by station id
    const maxId = data.stations.reduce((m, s) => Math.max(m, s.id), -1);
    const meta    = Array(maxId + 1).fill(null);
    const content = Array(maxId + 1).fill(null);
    data.stations.forEach(s => {
      const { task_html, sol_html, ...m } = s;
      meta[s.id]    = m;
      content[s.id] = { task_html: task_html || '', sol_html: sol_html || '', hilfen: s.hilfen || [] };
    });
    // Keep sparse array (nulls for deleted IDs) so META[id] addressing stays correct
    const metaClean    = meta;
    const contentClean = content;

    // Update GROUPS totals from actual station counts
    const groups = JSON.parse(JSON.stringify(data.groups));
    Object.keys(groups).forEach(g => {
      groups[g].total = data.stations.filter(s => s.group === g).length;
    });

    let html = fs.readFileSync(htmlPath, 'utf8');
    html = replaceJsConstant(html, 'TOTAL',   String(metaClean.length));
    html = replaceJsConstant(html, 'GROUPS',  JSON.stringify(groups));
    html = replaceJsConstant(html, 'META',    JSON.stringify(metaClean));
    html = replaceJsConstant(html, 'CONTENT', '[]');
    if (data.hilfen && data.hilfen.length) {
      html = replaceJsConstant(html, 'HILFEN', JSON.stringify(data.hilfen));
    }

    fs.writeFileSync(htmlPath, html, 'utf8');
    delete ltMetaCache[id]; // invalidate metadata cache

    // ── Orphan cleanup: remove progress for deleted station IDs ──────────────
    const existingIds = new Set(data.stations.map(s => s.id));
    // Read KEY dynamically from the (just-updated) HTML file
    const freshHtml = fs.readFileSync(htmlPath, 'utf8');
    const ltKey = extractJSValue(freshHtml, 'KEY');

    // Get all users who have progress for this lerntheke
    const users = await pool.query(
      `SELECT user_id, value FROM progress WHERE key = $1`, [ltKey]
    );
    let cleaned = 0;
    for (const row of users.rows) {
      try {
        const doneArr = JSON.parse(row.value);
        if (!Array.isArray(doneArr)) continue;
        const filtered = doneArr.filter(stId => existingIds.has(Number(stId)));
        if (filtered.length !== doneArr.length) {
          await pool.query(
            `UPDATE progress SET value=$1, updated_at=NOW() WHERE user_id=$2 AND key=$3`,
            [JSON.stringify(filtered), row.user_id, ltKey]
          );
          cleaned++;
        }
      } catch {}
    }

    // Delete orphaned input entries (format: {ltKey}_i{stationId})
    const inputPattern = `${ltKey}_i%`;
    const inputRows = await pool.query(
      `SELECT user_id, key FROM progress WHERE key LIKE $1`, [inputPattern]
    );
    for (const row of inputRows.rows) {
      const stId = parseInt(row.key.replace(ltKey + '_i', ''), 10);
      if (!isNaN(stId) && !existingIds.has(stId)) {
        await pool.query(`DELETE FROM progress WHERE user_id=$1 AND key=$2`, [row.user_id, row.key]);
      }
    }

    res.json({ ok: true, stations: data.stations.length, progressCleaned: cleaned });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Lerntheken list ───────────────────────────────────────────────────────────
app.get('/api/lerntheken', requireLogin, (req, res) => {
  const dir = path.join(__dirname, 'public', 'lerntheken');
  try {
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.html'))
      .map(f => ({
        id: f.replace('.html', ''),
        title: f.replace('.html', '').replace(/-/g, ' ').replace(/_/g, ' '),
        url: '/lerntheken/' + f
      }));
    res.json(files);
  } catch { res.json([]); }
});

// ── Lerntheken metadata (KEY, GROUPS, station→group map, totals) ──────────────
function extractJSValue(html, varName) {
  // Support const, let, and var declarations
  let idx = -1;
  let marker = '';
  for (const kw of ['const', 'let', 'var']) {
    const m = `${kw} ${varName}=`;
    const i = html.indexOf(m);
    if (i !== -1 && (idx === -1 || i < idx)) { idx = i; marker = m; }
  }
  if (idx === -1) return null;
  const start = idx + marker.length;
  const opener = html[start];

  // Quoted string
  if (opener === '"' || opener === "'") {
    let i = start + 1;
    while (i < html.length && html[i] !== opener) {
      if (html[i] === '\\') i++;
      i++;
    }
    return html.slice(start + 1, i);
  }

  // Array or object – bracket matching
  if (opener === '[' || opener === '{') {
    const closer = opener === '[' ? ']' : '}';
    let depth = 0, inStr = false, strChar = '', escaped = false, end = start;
    for (let i = start; i < html.length; i++) {
      const c = html[i];
      if (escaped) { escaped = false; continue; }
      if (inStr) {
        if (c === '\\') { escaped = true; continue; }
        if (c === strChar) inStr = false;
      } else {
        if (c === '"' || c === "'") { inStr = true; strChar = c; }
        else if (c === opener) depth++;
        else if (c === closer) { depth--; if (depth === 0) { end = i; break; } }
      }
    }
    try { return JSON.parse(html.slice(start, end + 1)); } catch { return null; }
  }

  // Number / boolean – read until ; or whitespace
  let end = start;
  while (end < html.length && !/[;\s]/.test(html[end])) end++;
  const raw = html.slice(start, end);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const n = Number(raw);
  return isNaN(n) ? null : n;
}

const ltMetaCache = {}; // cleared on server restart

function getLerntheckenMeta() {
  const dir = path.join(__dirname, 'public', 'lerntheken');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));
  return files.map(f => {
    const id = f.replace('.html', '');
    if (ltMetaCache[id]) return ltMetaCache[id];
    try {
      const html = fs.readFileSync(path.join(dir, f), 'utf8');
      const key       = extractJSValue(html, 'KEY');
      const abgabeKey = extractJSValue(html, 'ABGABE_KEY');
      const total     = extractJSValue(html, 'TOTAL');
      const groups    = extractJSValue(html, 'GROUPS');
      const meta      = extractJSValue(html, 'META');
      // strip task/sol HTML from meta to keep response small (filter nulls from deleted stations)
      const stations  = (meta || []).filter(Boolean).map(s => ({ id: s.id, group: s.group, title: s.title, mandatory: s.mandatory || false }));
      const rawTitle  = (html.match(/<title>([^<]+)<\/title>/) || [])[1] || id;
      const title     = rawTitle.replace(/\s*·.*$/, '').trim(); // strip " · Jahrgangsstufe X"
      const result = { id, title, url: `/lerntheken/${f}`, key, abgabeKey, total, groups, stations };
      ltMetaCache[id] = result;
      return result;
    } catch { return null; }
  }).filter(Boolean);
}

app.get('/api/lerntheken-meta', requireLogin, (req, res) => {
  try { res.json(getLerntheckenMeta()); }
  catch(e) { res.status(500).json({ error: 'Fehler beim Lesen der Metadaten' }); }
});

// ── Admin: students ───────────────────────────────────────────────────────────
app.get('/api/admin/students', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        u.id, u.username, u.klasse, u.created_at, u.kurs, u.aktiv,
        (SELECT json_object_agg(key, value)
         FROM progress WHERE user_id=u.id) AS all_progress,
        (SELECT json_build_object('key', key, 'updated_at', updated_at)
         FROM progress WHERE user_id=u.id
           AND key NOT SIMILAR TO '%[_]i[0-9]+'
           AND key NOT LIKE '%_abgabe_%'
         ORDER BY updated_at DESC LIMIT 1) AS last_active_info,
        (SELECT json_agg(json_build_object('gruppe',gruppe,'status',status,'notiz',notiz,'lerntheke',lerntheke))
         FROM korrektur WHERE user_id=u.id) AS korrektur,
        (SELECT json_agg(json_build_object('id',l.id,'typ',l.typ,'lerntheke',l.lerntheke,'datum',l.datum,
                                           'status',l.status,'pokale',l.pokale,'thema',l.thema,
                                           'anfrage',l.anfrage,'fach',sj.key))
         FROM lzk l LEFT JOIN subjects sj ON sj.id = l.subject_id WHERE l.user_id=u.id) AS lzk,
        (SELECT json_agg(json_build_object('lerntheke',lerntheke,'gesperrt',gesperrt,'kurs',kurs))
         FROM lerntheke_access WHERE user_id=u.id) AS access,
        (SELECT lerntheke FROM active_lerntheke WHERE user_id=u.id) AS active_lerntheke,
        (SELECT json_object_agg(s.key, usk.kurs)
         FROM user_subject_kurs usk JOIN subjects s ON s.id=usk.subject_id
         WHERE usk.user_id=u.id) AS subject_kurs
      FROM users u
      WHERE u.role='student' AND u.klasse=$1
      ORDER BY u.username
    `, [req.session.klasse]);
    res.json(r.rows.map(row => ({
      ...row,
      all_progress: safeJSON(row.all_progress)
    })));
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const k = req.session.klasse;
    const total  = (await pool.query('SELECT COUNT(*) n FROM users WHERE role=$1 AND klasse=$2', ['student', k])).rows[0].n;
    const active = (await pool.query(`
      SELECT COUNT(DISTINCT u.id) n FROM users u
      JOIN progress p ON p.user_id=u.id
      WHERE u.role='student' AND u.klasse=$1
        AND p.updated_at > NOW() - INTERVAL '7 days'
    `, [k])).rows[0].n;
    res.json({ klasse: k, total: parseInt(total), active: parseInt(active) });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

app.post('/api/admin/create-student', requireAdmin, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Fehlende Angaben' });
    if (password.length < 4) return res.status(400).json({ error: 'Passwort mind. 4 Zeichen' });
    await pool.query(
      'INSERT INTO users (username,password_hash,klasse,role) VALUES ($1,$2,$3,$4)',
      [username.trim().toLowerCase(), await bcrypt.hash(password, 10), req.session.klasse, 'student']
    );
    res.json({ ok: true });
  } catch(e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Benutzername bereits vergeben' });
    res.status(500).json({ error: 'Serverfehler' });
  }
});

// Admin legt Mit-Admin für das eigene Tandem an - muss beim ersten Login das (vom anlegenden
// Admin vergebene, temporäre) Passwort selbst ändern, analog zu den initial geseedeten Accounts.
app.post('/api/admin/create-admin', requireSuperAdmin, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Fehlende Angaben' });
    if (password.length < 4) return res.status(400).json({ error: 'Passwort mind. 4 Zeichen' });
    await pool.query(
      'INSERT INTO users (username,password_hash,klasse,role,must_change_password) VALUES ($1,$2,$3,$4,$5)',
      [username.trim().toLowerCase(), await bcrypt.hash(password, 10), req.session.klasse, 'admin', true]
    );
    res.json({ ok: true });
  } catch(e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Benutzername bereits vergeben' });
    res.status(500).json({ error: 'Serverfehler' });
  }
});

app.post('/api/admin/bulk-create', requireAdmin, async (req, res) => {
  try {
    const { students } = req.body;
    if (!Array.isArray(students)) return res.status(400).json({ error: 'Array erforderlich' });
    let created = 0, skipped = 0;
    for (const s of students) {
      if (!s.username || !s.password) { skipped++; continue; }
      try {
        await pool.query(
          'INSERT INTO users (username,password_hash,klasse,role) VALUES ($1,$2,$3,$4)',
          [s.username.trim().toLowerCase(), await bcrypt.hash(s.password, 10), req.session.klasse, 'student']
        );
        created++;
      } catch { skipped++; }
    }
    res.json({ ok: true, created, skipped });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

app.post('/api/admin/reset-password', requireAdmin, async (req, res) => {
  try {
    const { userId, newPassword } = req.body;
    if (!newPassword || newPassword.length < 4)
      return res.status(400).json({ error: 'Passwort mind. 4 Zeichen' });
    const r = await pool.query(
      'UPDATE users SET password_hash=$1 WHERE id=$2 AND klasse=$3 AND role=$4',
      [await bcrypt.hash(newPassword, 10), userId, req.session.klasse, 'student']
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

app.get('/api/admin/peers', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, username, super_admin AS "superAdmin", default_subject_id AS "defaultSubjectId"
       FROM users WHERE klasse=$1 AND role=$2 AND id != $3 ORDER BY username`,
      [req.session.klasse, 'admin', req.session.userId]
    );
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// Super-Admin legt das Fach einer anderen Lernbegleitung fest (Standard-Fach des Accounts).
app.post('/api/admin/peer/:id/default-subject', requireSuperAdmin, async (req, res) => {
  try {
    const { subjectId } = req.body;
    if (subjectId != null) {
      const check = await pool.query('SELECT id FROM subjects WHERE id=$1', [subjectId]);
      if (!check.rows.length) return res.status(400).json({ error: 'Ungültiges Fach' });
    }
    const r = await pool.query(
      'UPDATE users SET default_subject_id=$1 WHERE id=$2 AND klasse=$3 AND role=$4 RETURNING id',
      [subjectId ?? null, req.params.id, req.session.klasse, 'admin']
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// Super-Admin befördert eine andere Lernbegleitung zum Super-Admin (oder nimmt den Status
// wieder weg). Der eigene Status lässt sich nicht ändern - sonst könnte sich die letzte
// Person versehentlich selbst aussperren.
app.post('/api/admin/peer/:id/super-admin', requireSuperAdmin, async (req, res) => {
  try {
    const { superAdmin } = req.body;
    if (typeof superAdmin !== 'boolean') return res.status(400).json({ error: 'Ungültig' });
    if (Number(req.params.id) === req.session.userId)
      return res.status(400).json({ error: 'Eigener Super-Admin-Status kann nicht geändert werden' });
    const r = await pool.query(
      'UPDATE users SET super_admin=$1 WHERE id=$2 AND klasse=$3 AND role=$4 RETURNING id',
      [superAdmin, req.params.id, req.session.klasse, 'admin']
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

app.post('/api/admin/reset-admin-password', requireAdmin, async (req, res) => {
  try {
    const { userId, newPassword } = req.body;
    if (!newPassword || newPassword.length < 4)
      return res.status(400).json({ error: 'Passwort mind. 4 Zeichen' });
    const r = await pool.query(
      'UPDATE users SET password_hash=$1, must_change_password=TRUE WHERE id=$2 AND klasse=$3 AND role=$4 AND id != $5',
      [await bcrypt.hash(newPassword, 10), userId, req.session.klasse, 'admin', req.session.userId]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// Admin löscht einen Mit-Admin des eigenen Tandems - weder sich selbst noch den letzten
// verbleibenden Admin-Account (sonst wäre das Tandem ausgesperrt).
app.delete('/api/admin/peer/:id', requireSuperAdmin, async (req, res) => {
  try {
    if (Number(req.params.id) === req.session.userId)
      return res.status(400).json({ error: 'Eigener Account kann nicht gelöscht werden' });
    const countRes = await pool.query(
      'SELECT COUNT(*) n FROM users WHERE klasse=$1 AND role=$2',
      [req.session.klasse, 'admin']
    );
    if (parseInt(countRes.rows[0].n) <= 1)
      return res.status(400).json({ error: 'Letzter Admin-Account des Tandems kann nicht gelöscht werden' });
    const r = await pool.query(
      'DELETE FROM users WHERE id=$1 AND klasse=$2 AND role=$3',
      [req.params.id, req.session.klasse, 'admin']
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// Kontonamen (Alias) einer Schüler:in ändern. Ausdrücklich NUR das Namensfeld: sämtliche
// Daten hängen an users.id (Fortschritt, LZK, Korrektur, Talks/Fachbüro, Stationen,
// Flammen, Kurs-Zuordnung) - der Name wird nirgends als Referenz gespeichert. Ein
// Umbenennen lässt den kompletten Verlauf also unangetastet.
// Wichtig für die Praxis: die Person meldet sich danach mit dem NEUEN Namen an.
app.post('/api/admin/student/:id/rename', requireAdmin, async (req, res) => {
  try {
    const neu = String(req.body.username || '').trim().toLowerCase();
    if (!neu) return res.status(400).json({ error: 'Fehlende Angaben' });
    const r = await pool.query(
      'UPDATE users SET username=$1 WHERE id=$2 AND klasse=$3 AND role=$4 RETURNING id, username',
      [neu, req.params.id, req.session.klasse, 'student']
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json({ ok: true, id: r.rows[0].id, username: r.rows[0].username });
  } catch(e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Benutzername bereits vergeben' });
    res.status(500).json({ error: 'Serverfehler' });
  }
});

app.delete('/api/admin/student/:id', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      'DELETE FROM users WHERE id=$1 AND klasse=$2 AND role=$3',
      [req.params.id, req.session.klasse, 'student']
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function safeJSON(s) {
  if (!s) return {};
  if (typeof s === 'object') return s; // pg already parsed JSON columns
  try { return JSON.parse(s.replace(/^﻿/, '')); } catch { return {}; }
}


// ── Korrektur (Admin bewertet Abgaben) ───────────────────────────────────────

// Admin: get all korrektur status for a student (optionally scoped by lerntheke)
app.get('/api/admin/korrektur/:userId', requireAdmin, async (req, res) => {
  try {
    const lerntheke = req.query.lerntheke || '';
    const r = lerntheke
      ? await pool.query(
          'SELECT gruppe, status, notiz, updated_at FROM korrektur WHERE user_id=$1 AND lerntheke=$2',
          [req.params.userId, lerntheke])
      : await pool.query(
          'SELECT gruppe, status, notiz, updated_at FROM korrektur WHERE user_id=$1',
          [req.params.userId]);
    const out = {};
    r.rows.forEach(row => { out[row.gruppe] = { status: row.status, notiz: row.notiz, updated_at: row.updated_at }; });
    res.json(out);
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// Admin: set korrektur status
app.post('/api/admin/korrektur', requireAdmin, async (req, res) => {
  try {
    const { userId, gruppe, status, notiz, lerntheke } = req.body;
    if (!userId || !gruppe || !status) return res.status(400).json({ error: 'Fehlende Angaben' });
    if (!['ausstehend','bestanden','nicht_bestanden'].includes(status))
      return res.status(400).json({ error: 'Ungültiger Status' });
    const lt = lerntheke || '';
    await pool.query(`
      INSERT INTO korrektur (user_id, gruppe, lerntheke, status, notiz, admin_id, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (user_id, lerntheke, gruppe) DO UPDATE
      SET status=$4, notiz=$5, admin_id=$6, updated_at=NOW()
    `, [userId, gruppe, lt, status, notiz||'', req.session.userId]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// Student: get own korrektur status (optionally scoped by lerntheke)
app.get('/api/korrektur', requireLogin, async (req, res) => {
  try {
    const lerntheke = req.query.lerntheke || '';
    const r = lerntheke
      ? await pool.query(
          'SELECT gruppe, status, notiz, lerntheke FROM korrektur WHERE user_id=$1 AND lerntheke=$2',
          [req.session.userId, lerntheke])
      : await pool.query(
          'SELECT gruppe, status, notiz, lerntheke FROM korrektur WHERE user_id=$1',
          [req.session.userId]);
    const out = {};
    r.rows.forEach(row => { out[row.gruppe] = { status: row.status, notiz: row.notiz, lerntheke: row.lerntheke }; });
    res.json(out);
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// Student: erneut abgeben (setzt Korrekturstatus auf ausstehend)
app.post('/api/korrektur/reset', requireLogin, async (req, res) => {
  try {
    const { gruppe, lerntheke } = req.body;
    if (!gruppe) return res.status(400).json({ error: 'Fehlende Gruppe' });
    const lt = lerntheke || '';
    await pool.query(`
      INSERT INTO korrektur (user_id, gruppe, lerntheke, status, notiz, updated_at)
      VALUES ($1, $2, $3, 'ausstehend', '', NOW())
      ON CONFLICT (user_id, lerntheke, gruppe) DO UPDATE
      SET status='ausstehend', notiz='', updated_at=NOW()
    `, [req.session.userId, gruppe, lt]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// ── LZK ──────────────────────────────────────────────────────────────────────

app.get('/api/subjects', requireLogin, async (req, res) => {
  try {
    const [r, ov] = await Promise.all([
      pool.query(`
        SELECT id, key, name, color, color_bg AS "colorBg", default_ort AS "defaultOrt",
               nur_zugewiesen AS "nurZugewiesen",
               default_dauer AS "defaultDauer", pflicht_praesentieren AS "pflichtPraesentieren",
               pflicht_zuhoeren AS "pflichtZuhoeren",
               optional_praesentieren AS "optionalPraesentieren",
               optional_zuhoeren AS "optionalZuhoeren"
        FROM subjects ORDER BY id
      `),
      pool.query(`
        SELECT subject_id AS "subjectId", halbjahr,
               pflicht_praesentieren AS "pflichtPraesentieren",
               pflicht_zuhoeren AS "pflichtZuhoeren",
               optional_praesentieren AS "optionalPraesentieren",
               optional_zuhoeren AS "optionalZuhoeren"
        FROM subject_halbjahr_targets ORDER BY halbjahr
      `),
    ]);
    // Abweichende Vorgaben je Halbjahr direkt am Fach mitliefern - die Felder heißen genauso
    // wie die Fach-Standardwerte, damit das Frontend einheitlich nachschlagen kann.
    const rows = r.rows.map(s => ({ ...s, halbjahrTargets: {} }));
    const byId = {};
    rows.forEach(s => { byId[s.id] = s; });
    ov.rows.forEach(o => {
      const s = byId[o.subjectId];
      if (!s) return;
      s.halbjahrTargets[o.halbjahr] = {
        pflichtPraesentieren: o.pflichtPraesentieren, pflichtZuhoeren: o.pflichtZuhoeren,
        optionalPraesentieren: o.optionalPraesentieren, optionalZuhoeren: o.optionalZuhoeren,
      };
    });
    res.json(rows);
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// Nur die vom Admin konfigurierbaren Default-Werte (Name/Farbe/Key bleiben fest).
// Ort/Dauer gelten immer fach-weit. Die vier Vorgaben-Zahlen gelten je nach `halbjahr`:
// leer = Fach-Standard, gesetzt = nur für dieses Halbjahr (subject_halbjahr_targets).
// `reset: true` + halbjahr entfernt die Abweichung wieder, danach gilt dort der Standard.
app.post('/api/admin/subjects/:id', requireAdmin, async (req, res) => {
  try {
    const { defaultOrt, defaultDauer, pflichtPraesentieren, pflichtZuhoeren,
            optionalPraesentieren, optionalZuhoeren, halbjahr, reset } = req.body;
    const dauer = Math.min(600, Math.max(5, parseInt(defaultDauer) || 45));
    const pp = Math.min(10, Math.max(0, parseInt(pflichtPraesentieren)));
    const pz = Math.min(10, Math.max(0, parseInt(pflichtZuhoeren)));
    const op = Math.min(10, Math.max(0, parseInt(optionalPraesentieren)));
    const oz = Math.min(10, Math.max(0, parseInt(optionalZuhoeren)));
    const hj = (halbjahr || '').trim();

    const exists = await pool.query('SELECT id FROM subjects WHERE id=$1', [req.params.id]);
    if (!exists.rows.length) return res.status(404).json({ error: 'Nicht gefunden' });

    await pool.query(`UPDATE subjects SET default_ort=$1, default_dauer=$2 WHERE id=$3`,
      [defaultOrt || '', dauer, req.params.id]);

    if (!hj) {
      await pool.query(
        `UPDATE subjects SET pflicht_praesentieren=$1, pflicht_zuhoeren=$2,
                             optional_praesentieren=$3, optional_zuhoeren=$4 WHERE id=$5`,
        [isNaN(pp) ? 1 : pp, isNaN(pz) ? 2 : pz, isNaN(op) ? 2 : op, isNaN(oz) ? 1 : oz, req.params.id]
      );
    } else if (reset) {
      await pool.query('DELETE FROM subject_halbjahr_targets WHERE subject_id=$1 AND halbjahr=$2',
        [req.params.id, hj]);
    } else {
      await pool.query(`
        INSERT INTO subject_halbjahr_targets
          (subject_id, halbjahr, pflicht_praesentieren, pflicht_zuhoeren, optional_praesentieren, optional_zuhoeren)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (subject_id, halbjahr) DO UPDATE
          SET pflicht_praesentieren=$3, pflicht_zuhoeren=$4,
              optional_praesentieren=$5, optional_zuhoeren=$6, updated_at=NOW()
      `, [req.params.id, hj, isNaN(pp) ? 1 : pp, isNaN(pz) ? 2 : pz, isNaN(op) ? 2 : op, isNaN(oz) ? 1 : oz]);
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

app.get('/api/leaderboard', requireLogin, async (req, res) => {
  try {
    const allMeta = getLerntheckenMeta();

    // Station-ID → group lookup + group configs per lerntheke key
    const ltLookup = {}; // key → { stMap:{id→group}, groups:{name→{required,total}} }
    let globalMax = 0;
    allMeta.forEach(lt => {
      const stMap = {};
      (lt.stations || []).forEach(s => { stMap[s.id] = s.group; });
      ltLookup[lt.key] = { stMap, groups: lt.groups || {} };
      Object.values(lt.groups || {}).forEach(grp => { if (grp.total > 0) globalMax += 3; });
      ['Basis','Aufbau'].forEach(typ => { if (lt.groups && lt.groups[typ]) globalMax += 3; });
    });

    function tc(done, req, total) {
      if (done < req || total <= 0) return 0;
      const extra = total - req;
      if (extra === 0) return 3;
      if (done >= total) return 3;
      if (done >= req + Math.ceil(extra / 3)) return 2;
      return 1;
    }

    const [usersRes, progRes, lzkRes, accessRes, tsPresRes, tsListenRes, tsHalbjahrRes, subjectsRes, hjTargetsRes] = await Promise.all([
      pool.query(`SELECT id, username, kurs, klasse, created_at FROM users WHERE role='student' AND aktiv=true`),
      pool.query(`SELECT user_id, key, value FROM progress WHERE key NOT LIKE '%_abgabe_%' AND key NOT SIMILAR TO '%[_]i[0-9]+' AND value LIKE '[%'`),
      pool.query(`SELECT user_id, lerntheke, typ, pokale, anfrage FROM lzk`),
      pool.query(`SELECT user_id, lerntheke, gesperrt, kurs FROM lerntheke_access`),
      pool.query(`
        SELECT ts.presenter_id AS user_id, ts.presented_status AS "presentedStatus", ts.pokale, sl.halbjahr, sl.datum, sl.subject_id AS "subjectId"
        FROM talking_sessions ts JOIN talking_slots sl ON sl.id = ts.slot_id
        WHERE sl.typ = 'talk'
      `),
      pool.query(`
        SELECT ti.listener_id AS user_id, ti.attended_status AS "attendedStatus", ti.pokale, sl.halbjahr, sl.datum, sl.subject_id AS "subjectId"
        FROM talking_invitations ti
        JOIN talking_sessions ts ON ts.id = ti.session_id
        JOIN talking_slots sl ON sl.id = ts.slot_id
        WHERE ti.status = 'angenommen' AND sl.typ = 'talk'
      `),
      pool.query(`SELECT DISTINCT klasse, halbjahr, subject_id AS "subjectId" FROM talking_slots WHERE typ='talk'`),
      pool.query(`SELECT id, pflicht_praesentieren AS "pflichtP", pflicht_zuhoeren AS "pflichtZ" FROM subjects`),
      pool.query(`SELECT subject_id, halbjahr, pflicht_praesentieren, pflicht_zuhoeren FROM subject_halbjahr_targets`),
    ]);

    const progByUser = {};
    progRes.rows.forEach(row => {
      if (!progByUser[row.user_id]) progByUser[row.user_id] = {};
      try { progByUser[row.user_id][row.key] = JSON.parse(row.value); } catch {}
    });
    const lzkByUser = {};
    lzkRes.rows.forEach(row => {
      if (!lzkByUser[row.user_id]) lzkByUser[row.user_id] = [];
      lzkByUser[row.user_id].push(row);
    });
    // access lookup: userId → { ltKey → { gesperrt, kurs } }
    const accessByUser = {};
    accessRes.rows.forEach(row => {
      if (!accessByUser[row.user_id]) accessByUser[row.user_id] = {};
      accessByUser[row.user_id][row.lerntheke] = { gesperrt: row.gesperrt, kurs: row.kurs };
    });
    const tsPresByUser = {};
    tsPresRes.rows.forEach(row => { (tsPresByUser[row.user_id] ||= []).push(row); });
    const tsListenByUser = {};
    tsListenRes.rows.forEach(row => { (tsListenByUser[row.user_id] ||= []).push(row); });
    // Je Fach eigene Pflicht-Mindestanzahl -> Halbjahre + Trophäen müssen pro (Klasse, Fach) getrennt bleiben.
    const tsHalbjahreByKlasseSubject = {};
    tsHalbjahrRes.rows.forEach(row => { const k = row.klasse + '|' + row.subjectId; (tsHalbjahreByKlasseSubject[k] ||= []).push(row.halbjahr); });
    const subjectThresholds = {};
    subjectsRes.rows.forEach(s => { subjectThresholds[s.id] = { pflichtP: s.pflichtP, pflichtZ: s.pflichtZ }; });

    const rows = usersRes.rows.map(u => {
      let pokale = 0, ownMax = 0;
      const uProg = progByUser[u.id] || {};
      const uAccess = accessByUser[u.id] || {};
      const globalKurs = u.kurs || 'E';
      allMeta.forEach(lt => {
        const acc = uAccess[lt.key];
        if (!acc || acc.gesperrt !== false) return; // gesperrt oder kein Eintrag → nicht zählen
        const lu = ltLookup[lt.key];
        if (!lu) return;
        const kurs = acc.kurs || globalKurs;
        const doneIds = uProg[lt.key] || [];
        const doneCounts = {};
        doneIds.forEach(id => { const g = lu.stMap[id]; if (g) doneCounts[g] = (doneCounts[g] || 0) + 1; });
        Object.entries(lu.groups).forEach(([g, grp]) => {
          if (kurs === 'G' && g === 'Aufbau') return;
          if (grp.total > 0) { pokale += tc(doneCounts[g] || 0, grp.required, grp.total); ownMax += 3; }
        });
        (lzkByUser[u.id] || []).forEach(lzk => {
          if (lzk.lerntheke !== lt.key) return;
          if (kurs === 'G' && lzk.typ === 'Aufbau') return;
          pokale += lzk.pokale || 0;
          if (lu.groups[lzk.typ]) ownMax += 3; // only count LZK max when entry exists (matches client)
        });
      });
      // Freie LZK (ohne Lerntheke, jedes Fach): ein fester Termin zaehlt wie eine
      // Lerntheken-LZK 3 Flammen ins Maximum; offene/abgelehnte Anfragen zaehlen nicht.
      (lzkByUser[u.id] || []).forEach(lzk => {
        if (lzk.lerntheke || lzk.anfrage) return;
        pokale += lzk.pokale || 0;
        ownMax += 3;
      });
      // Talk-Pokale je Fach getrennt berechnen (eigene Pflicht-Schwellen), dann summieren.
      const uPres = tsPresByUser[u.id] || [];
      const uListen = tsListenByUser[u.id] || [];
      Object.keys(subjectThresholds).map(Number).forEach(subjectId => {
        // Nur Halbjahre, in denen dieser Account schon existierte (sonst unerreichbares Maximum).
        const hjs = (tsHalbjahreByKlasseSubject[u.klasse + '|' + subjectId] || [])
          .filter(hj => halbjahrCountsForUser(hj, u.created_at));
        if (!hjs.length) return; // dieses Fach hat in der Klasse (noch) keine Talk-Slots -> nichts zu zählen
        const th = subjectThresholds[subjectId];
        const subPres = uPres.filter(r => r.subjectId === subjectId);
        const subListen = uListen.filter(r => r.subjectId === subjectId);
        const t = computeTalkingTrophies(hjs, subPres, subListen,
          buildTargetsResolver({ id: subjectId, pflichtP: th.pflichtP, pflichtZ: th.pflichtZ }, hjTargetsRes.rows));
        pokale += t.earned; ownMax += t.max;
      });
      return { username: u.username, pokale, ownMax };
    });

    rows.sort((a, b) => b.pokale - a.pokale || a.username.localeCompare(b.username));
    res.json({ rows, globalMax });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── LZK ─────────────────────────────────────────────────────────────────────
// Ergebnis-Regel: Flammen heissen bestanden. Wer 1-3 Flammen vergibt, ohne den
// Status mitzuschicken (oder mit 'ausstehend'), hat die LZK damit bestanden;
// 'nicht_bestanden' und 'ausstehend' tragen keine Flammen. Liefert NUR die Felder,
// die tatsaechlich gesetzt werden - nicht mitgeschickte bleiben unangetastet.
const LZK_STATUS = ['ausstehend', 'bestanden', 'nicht_bestanden'];
// Typ einer FREIEN LZK: 'LZK' allgemein; in Mathe auch 'Basis'/'Aufbau' - daran
// erkennt das Python-Tool, in welchen LZK-Platz eines Bausteins sie gehoert.
const LZK_TYPEN = ['LZK', 'Basis', 'Aufbau'];
const lzkTyp = t => (LZK_TYPEN.includes(t) ? t : 'LZK');
function lzkErgebnis(body) {
  const hat = k => Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined;
  const out = {};
  if (hat('status')) out.status = body.status;
  if (hat('pokale')) out.pokale = Math.min(3, Math.max(0, parseInt(body.pokale) || 0));
  if (out.pokale > 0 && out.status !== 'nicht_bestanden') out.status = 'bestanden';
  if (out.status === 'nicht_bestanden' || out.status === 'ausstehend') out.pokale = 0;
  return out;
}
const heuteIsoLzk = () => new Date().toISOString().slice(0, 10);
const istIsoDatum = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

// Felder, die ueberall gleich ausgeliefert werden. datum bleibt im alten Format
// (die Lerntheke liest es so), dazu datumIso fuer alles Neue.
const LZK_FELDER = `l.id, l.user_id AS "userId", l.typ, l.lerntheke, l.datum,
  to_char(l.datum,'YYYY-MM-DD') AS "datumIso", l.status, l.pokale,
  l.subject_id AS "subjectId", l.thema, l.anfrage, l.herkunft`;

// Dieselbe freie LZK nicht zweimal anlegen (Doppelklick, erneutes Senden nach einem
// Verbindungsabbruch): gibt es fuer die Person schon eine gleiche - gleiches Fach, gleicher
// Typ, gleicher Tag, gleiches Thema (Gross/klein und Leerzeichen egal) -, wird sie
// wiederverwendet. Pruefen und Anlegen laufen unter einer Sperre in EINER Transaktion,
// sonst kaemen zwei fast gleichzeitige Klicks beide an der Pruefung vorbei.
const LZK_ANLEGEN_SPERRE = 7412001;
async function lzkUnterSperre(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [LZK_ANLEGEN_SPERRE]);
    const ergebnis = await fn(client);
    await client.query('COMMIT');
    return ergebnis;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

app.get('/api/lzk', requireLogin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT ${LZK_FELDER} FROM lzk l WHERE l.user_id=$1`,
      [req.session.userId]
    );
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// Schueler:in fragt eine freie LZK an (ohne Lerntheke). Schueler:innen legen LZK-Termine
// NIE selbst fest (Nutzervorgabe 2026-09-24) - es entsteht immer eine offene Anfrage,
// die die Lernbegleitung annimmt oder ablehnt. Ein Wunschtermin ist freiwillig.
app.post('/api/lzk', requireLogin, async (req, res) => {
  try {
    if (req.session.role !== 'student')
      return res.status(403).json({ error: 'Hier legen nur Schüler:innen ihre eigenen LZK an.' });
    const subjectId = parseInt(req.body.subjectId);
    const thema = String(req.body.thema || '').trim().slice(0, 200);
    const datum = String(req.body.datum || '').trim() || null;
    const subj = await pool.query(
      'SELECT id, nur_zugewiesen AS "nurZugewiesen" FROM subjects WHERE id=$1', [subjectId]);
    if (!subj.rows.length) return res.status(400).json({ error: 'Unbekanntes Fach.' });
    if (subj.rows[0].nurZugewiesen)
      return res.status(403).json({ error: 'In diesem Bereich vergibt die Lernbegleitung die Termine.' });
    if (datum && !istIsoDatum(datum)) return res.status(400).json({ error: 'Ungültiges Datum.' });
    if (datum && datum < heuteIsoLzk())
      return res.status(409).json({ error: 'Der Termin liegt in der Vergangenheit.' });
    const typ = lzkTyp(req.body.typ);
    const neu = await lzkUnterSperre(async client => {
      // Dieselbe Anfrage (auch ohne Wunschtermin) steht schon offen: die gilt.
      const da = await client.query(`
        SELECT id FROM lzk
        WHERE user_id=$1 AND lerntheke IS NULL AND anfrage='offen' AND subject_id=$2 AND typ=$3
          AND datum IS NOT DISTINCT FROM $4::date AND lower(btrim(thema)) = lower(btrim($5))
        ORDER BY id LIMIT 1
      `, [req.session.userId, subjectId, typ, datum, thema]);
      if (da.rows.length) return { id: da.rows[0].id, vorhanden: true };
      const r = await client.query(`
        INSERT INTO lzk (user_id, lerntheke, typ, datum, status, pokale, subject_id, thema, anfrage, herkunft, updated_at)
        VALUES ($1, NULL, $6, $2, 'ausstehend', 0, $3, $4, $5, 'selbst', NOW())
        RETURNING id
      `, [req.session.userId, datum, subjectId, thema, 'offen', typ]);
      return { id: r.rows[0].id, vorhanden: false };
    });
    res.json({ ok: true, id: neu.id, anfrage: 'offen', vorhanden: neu.vorhanden });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// Schueler:in zieht eine eigene Anfrage zurueck bzw. blendet eine abgelehnte aus. Ein
// bestaetigter Termin gehoert nicht mehr der Schueler:in allein - den verlegt oder
// streicht die Lernbegleitung (wie das Festlegen, siehe POST /api/lzk).
app.delete('/api/lzk/:id', requireLogin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, lerntheke, herkunft, status, anfrage FROM lzk WHERE id=$1 AND user_id=$2`,
      [req.params.id, req.session.userId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Nicht gefunden.' });
    const l = r.rows[0];
    if (l.lerntheke) return res.status(409).json({ error: 'LZK einer Lerntheke änderst du in der Lerntheke.' });
    if (l.herkunft !== 'selbst') return res.status(409).json({ error: 'Diesen Termin hat die Lernbegleitung angelegt.' });
    if (l.status !== 'ausstehend') return res.status(409).json({ error: 'Die LZK ist schon bewertet.' });
    if (!l.anfrage) return res.status(409).json({ error: 'Der Termin ist bestätigt – sprich die Lernbegleitung an.' });
    await pool.query('DELETE FROM lzk WHERE id=$1', [l.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// Student: set LZK datum (only if prerequisites met – server trusts client check, admin can always set)
// Lerntheke: Wunschtermin fuer die Basis-/Aufbau-LZK. Schueler:innen legen den Termin
// nie selbst fest (Nutzervorgabe 2026-09-24) - ein neuer oder geaenderter Wunsch ist
// immer eine offene Anfrage, auch wenn vorher schon ein Termin bestaetigt war. Eine
// bewertete LZK bleibt unangetastet.
app.post('/api/lzk/termin', requireLogin, async (req, res) => {
  try {
    const { lerntheke, typ } = req.body;
    const datum = String(req.body.datum || '').slice(0, 10);
    if (!lerntheke || !typ || !datum) return res.status(400).json({ error: 'Fehlende Angaben' });
    if (!istIsoDatum(datum)) return res.status(400).json({ error: 'Ungültiges Datum.' });
    const schueli = req.session.role === 'student';
    if (schueli && datum < heuteIsoLzk())
      return res.status(409).json({ error: 'Der Termin liegt in der Vergangenheit.' });
    const anfrage = schueli ? 'offen' : null;
    const r = await pool.query(`
      INSERT INTO lzk (user_id, lerntheke, typ, datum, status, pokale, updated_at, subject_id, anfrage)
      VALUES ($1,$2,$3,$4,'ausstehend',0,NOW(),(SELECT id FROM subjects WHERE key='mathe'),$5)
      ON CONFLICT (user_id, lerntheke, typ) DO UPDATE
      SET datum=$4, anfrage=$5, updated_at=NOW()
      WHERE lzk.status = 'ausstehend'
      RETURNING id
    `, [req.session.userId, lerntheke, typ, datum, anfrage]);
    if (!r.rows.length) return res.status(409).json({ error: 'Diese LZK ist schon bewertet.' });
    res.json({ ok: true, anfrage });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// Admin: get all LZK entries for students in their class
app.get('/api/admin/lzk', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT ${LZK_FELDER}, l.user_id, l.updated_at, u.username
      FROM lzk l JOIN users u ON u.id=l.user_id
      WHERE u.klasse=$1 AND u.role='student'
      ORDER BY u.username, l.lerntheke, l.typ
    `, [req.session.klasse]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// Admin: LZK einer Lerntheke setzen (datum, status, pokale). Wird auch vom Python-Tool
// benutzt. Seit 2026-09-24 werden NUR die mitgeschickten Felder geaendert - vorher
// setzte ein Aufruf mit blossem Datum eine bestandene LZK samt Flammen zurueck.
app.post('/api/admin/lzk', requireAdmin, async (req, res) => {
  try {
    const { userId, lerntheke, typ } = req.body;
    if (!userId || !lerntheke || !typ) return res.status(400).json({ error: 'Fehlende Angaben' });
    if (req.body.status !== undefined && !LZK_STATUS.includes(req.body.status))
      return res.status(400).json({ error: 'Ungültiger Status' });
    if (req.body.datum && !istIsoDatum(String(req.body.datum).slice(0, 10)))
      return res.status(400).json({ error: 'Ungültiges Datum' });
    const person = await pool.query(
      "SELECT id FROM users WHERE id=$1 AND klasse=$2 AND role='student'", [userId, req.session.klasse]);
    if (!person.rows.length) return res.status(404).json({ error: 'Schüler:in nicht gefunden' });
    const erg = lzkErgebnis(req.body);
    const hatDatum = req.body.datum !== undefined;
    await pool.query(`
      INSERT INTO lzk (user_id, lerntheke, typ, datum, status, pokale, admin_id, updated_at, subject_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),(SELECT id FROM subjects WHERE key='mathe'))
      ON CONFLICT (user_id, lerntheke, typ) DO UPDATE SET
        datum  = CASE WHEN $8  THEN EXCLUDED.datum  ELSE lzk.datum  END,
        status = CASE WHEN $9  THEN EXCLUDED.status ELSE lzk.status END,
        pokale = CASE WHEN $10 THEN EXCLUDED.pokale ELSE lzk.pokale END,
        admin_id=$7, updated_at=NOW()
    `, [userId, lerntheke, typ,
        hatDatum ? (String(req.body.datum || '').slice(0, 10) || null) : null,
        erg.status || 'ausstehend', erg.pokale || 0, req.session.userId,
        hatDatum, erg.status !== undefined, erg.pokale !== undefined]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// Admin: freie LZK fuer eine oder mehrere Schueler:innen anlegen (ohne Lerntheke,
// fachgebunden). Jede Person bekommt ihre EIGENE LZK - gleicher Tag, gleiches Thema,
// aber Bewertung und Flammen bleiben personengebunden. userIds (Liste) oder, fuer
// aeltere Aufrufer, userId. Alles oder nichts: steht auch nur eine Person nicht in
// der eigenen Lerngruppe, wird gar nichts angelegt - sonst entstuende eine halbe Gruppe.
app.post('/api/admin/lzk/eintrag', requireAdmin, async (req, res) => {
  try {
    const roh = Array.isArray(req.body.userIds) ? req.body.userIds : [req.body.userId];
    const userIds = [...new Set(roh.map(x => parseInt(x)).filter(Boolean))];
    const subjectId = parseInt(req.body.subjectId);
    const thema = String(req.body.thema || '').trim().slice(0, 200);
    const datum = String(req.body.datum || '').trim();
    if (!userIds.length || !subjectId) return res.status(400).json({ error: 'Bitte mindestens eine Person auswählen.' });
    if (!istIsoDatum(datum)) return res.status(400).json({ error: 'Bitte ein Datum wählen.' });
    const [personen, subj] = await Promise.all([
      pool.query("SELECT id FROM users WHERE id = ANY($1::int[]) AND klasse=$2 AND role='student'",
        [userIds, req.session.klasse]),
      pool.query('SELECT id FROM subjects WHERE id=$1', [subjectId]),
    ]);
    if (personen.rows.length !== userIds.length)
      return res.status(404).json({ error: 'Mindestens eine Person gehört nicht zu dieser Lerngruppe – nichts angelegt.' });
    if (!subj.rows.length) return res.status(400).json({ error: 'Unbekanntes Fach' });
    const typ = lzkTyp(req.body.typ);
    // Alles in EINER Transaktion: entweder stehen danach alle LZK da oder keine.
    const { je: idJe, vorhanden } = await lzkUnterSperre(async client => {
      // Wer die gleiche feste LZK schon hat, behaelt sie - auch eine schon bewertete.
      const da = await client.query(`
        SELECT DISTINCT ON (user_id) user_id, id FROM lzk
        WHERE user_id = ANY($1::int[]) AND lerntheke IS NULL AND anfrage IS NULL
          AND subject_id=$2 AND typ=$3 AND datum=$4::date AND lower(btrim(thema)) = lower(btrim($5))
        ORDER BY user_id, id
      `, [userIds, subjectId, typ, datum, thema]);
      const je = new Map(da.rows.map(x => [x.user_id, x.id]));
      const fehlen = userIds.filter(u => !je.has(u));
      if (fehlen.length) {
        const r = await client.query(`
          INSERT INTO lzk (user_id, lerntheke, typ, datum, status, pokale, subject_id, thema, anfrage, herkunft, admin_id, updated_at)
          SELECT u, NULL, $6, $2, 'ausstehend', 0, $3, $4, NULL, 'lernbegleitung', $5, NOW()
          FROM unnest($1::int[]) AS u
          RETURNING id, user_id
        `, [fehlen, datum, subjectId, thema, req.session.userId, typ]);
        r.rows.forEach(x => je.set(x.user_id, x.id));
      }
      return { je, vorhanden: da.rows.length };
    });
    const ids = userIds.map(u => idJe.get(u));
    res.json({ ok: true, id: ids[0], ids, vorhanden });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// Admin: eine LZK aendern - Datum, Thema, Ergebnis (Status/Flammen) und/oder eine
// Anfrage entscheiden. Nur mitgeschickte Felder werden geaendert.
app.patch('/api/admin/lzk/:id', requireAdmin, async (req, res) => {
  try {
    const cur = await pool.query(`
      SELECT l.id, l.lerntheke, l.anfrage, l.datum IS NOT NULL AS "hatDatum"
      FROM lzk l JOIN users u ON u.id = l.user_id
      WHERE l.id=$1 AND u.klasse=$2 AND u.role='student'
    `, [req.params.id, req.session.klasse]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Nicht gefunden' });
    const b = req.body;
    if (b.status !== undefined && !LZK_STATUS.includes(b.status))
      return res.status(400).json({ error: 'Ungültiger Status' });
    const sets = [], werte = [];
    const setze = (spalte, wert) => { werte.push(wert); sets.push(`${spalte}=$${werte.length}`); };
    if (b.datum !== undefined) {
      const d = String(b.datum || '').slice(0, 10);
      if (d && !istIsoDatum(d)) return res.status(400).json({ error: 'Ungültiges Datum' });
      setze('datum', d || null);
    }
    if (b.thema !== undefined) {
      if (cur.rows[0].lerntheke) return res.status(409).json({ error: 'Das Thema einer Lerntheken-LZK ist die Lerntheke.' });
      setze('thema', String(b.thema || '').trim().slice(0, 200));
    }
    if (b.typ !== undefined) {
      if (cur.rows[0].lerntheke) return res.status(409).json({ error: 'Basis/Aufbau einer Lerntheken-LZK steht fest.' });
      if (!LZK_TYPEN.includes(b.typ)) return res.status(400).json({ error: 'Ungültiger Typ' });
      setze('typ', b.typ);
    }
    if (b.anfrage !== undefined) {
      if (cur.rows[0].anfrage !== 'offen') return res.status(409).json({ error: 'Hier ist keine Anfrage offen.' });
      if (b.anfrage === 'annehmen') {
        // Angenommen heisst: es gibt einen festen Termin. Ohne Datum wuerde die LZK
        // nirgends im Kalender auftauchen.
        if (!cur.rows[0].hatDatum && !(b.datum && String(b.datum).trim()))
          return res.status(400).json({ error: 'Zum Annehmen bitte ein Datum festlegen.' });
        setze('anfrage', null);
      } else if (b.anfrage === 'ablehnen') {
        setze('anfrage', 'abgelehnt');
      } else return res.status(400).json({ error: 'Ungültige Entscheidung' });
    }
    const erg = lzkErgebnis(b);
    if (erg.status !== undefined) setze('status', erg.status);
    if (erg.pokale !== undefined) setze('pokale', erg.pokale);
    if (!sets.length) return res.status(400).json({ error: 'Nichts zu ändern' });
    setze('admin_id', req.session.userId);
    werte.push(cur.rows[0].id);
    await pool.query(`UPDATE lzk SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${werte.length}`, werte);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

app.delete('/api/admin/lzk/:id', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(`
      DELETE FROM lzk l USING users u
      WHERE l.id=$1 AND u.id=l.user_id AND u.klasse=$2 AND u.role='student'
      RETURNING l.id
    `, [req.params.id, req.session.klasse]);
    if (!r.rows.length) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// Admin: get full progress (including inputs) of a specific student
app.get('/api/admin/student-progress/:userId', requireAdmin, async (req, res) => {
  try {
    const userId = req.params.userId;
    // Verify student belongs to admin's class
    const user = await pool.query(
      'SELECT id, username, klasse FROM users WHERE id=$1 AND klasse=$2 AND role=$3',
      [userId, req.session.klasse, 'student']
    );
    if (!user.rows.length) return res.status(404).json({ error: 'Nicht gefunden' });

    const rows = await pool.query(
      'SELECT key, value FROM progress WHERE user_id=$1',
      [userId]
    );
    const progress = {};
    rows.rows.forEach(r => { progress[r.key] = r.value; });
    res.json({ username: user.rows[0].username, progress });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// ── Lerntheke Access (Admin) ───────────────────────────────────────────────────
app.post('/api/admin/access', requireAdmin, async (req, res) => {
  try {
    const { userId, lerntheke, gesperrt } = req.body;
    await pool.query(`
      INSERT INTO lerntheke_access (user_id, lerntheke, gesperrt, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (user_id, lerntheke) DO UPDATE SET gesperrt=$3, updated_at=NOW()
    `, [userId, lerntheke, gesperrt]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// ── Active Lerntheke (Student) ─────────────────────────────────────────────────
app.get('/api/active-lerntheke', requireLogin, async (req, res) => {
  try {
    const r = await pool.query('SELECT lerntheke FROM active_lerntheke WHERE user_id=$1', [req.session.userId]);
    res.json({ lerntheke: r.rows[0]?.lerntheke || null });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

app.post('/api/active-lerntheke', requireLogin, async (req, res) => {
  try {
    const { lerntheke } = req.body;
    await pool.query(`
      INSERT INTO active_lerntheke (user_id, lerntheke, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_id) DO UPDATE SET lerntheke=$2, updated_at=NOW()
    `, [req.session.userId, lerntheke]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// ── Access check für Student ───────────────────────────────────────────────────
app.get('/api/access', requireLogin, async (req, res) => {
  try {
    const [accRes, userRes] = await Promise.all([
      pool.query('SELECT lerntheke, gesperrt, kurs FROM lerntheke_access WHERE user_id=$1', [req.session.userId]),
      pool.query('SELECT kurs FROM users WHERE id=$1', [req.session.userId]),
    ]);
    const globalKurs = userRes.rows[0]?.kurs || 'E';
    const out = { _kursDefault: globalKurs };
    accRes.rows.forEach(row => {
      out[row.lerntheke] = row.gesperrt;
      if (row.kurs) out['_kurs_' + row.lerntheke] = row.kurs;
    });
    res.json(out);
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// ── Admin: Kurs setzen (global/pro Fach oder pro Lerntheke) ────────────────────
app.post('/api/admin/set-kurs', requireAdmin, async (req, res) => {
  try {
    const { userId, kurs, lerntheke, subjectId } = req.body;
    if (!['E','G'].includes(kurs)) return res.status(400).json({ error: 'Ungültig' });
    const u = await pool.query('SELECT id FROM users WHERE id=$1 AND klasse=$2 AND role=$3', [userId, req.session.klasse, 'student']);
    if (!u.rows.length) return res.status(403).json({ error: 'Nicht gefunden' });
    if (lerntheke) {
      await pool.query(`
        INSERT INTO lerntheke_access (user_id, lerntheke, gesperrt, kurs)
        VALUES ($1, $2, false, $3)
        ON CONFLICT (user_id, lerntheke) DO UPDATE SET kurs=$3, updated_at=NOW()
      `, [userId, lerntheke, kurs]);
    } else {
      const subjRes = subjectId
        ? await pool.query('SELECT id, key FROM subjects WHERE id=$1', [subjectId])
        : await pool.query(`SELECT id, key FROM subjects WHERE key='mathe'`);
      const subj = subjRes.rows[0];
      if (!subj) return res.status(400).json({ error: 'Unbekanntes Fach' });
      await pool.query(`
        INSERT INTO user_subject_kurs (user_id, subject_id, kurs)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, subject_id) DO UPDATE SET kurs=$3, updated_at=NOW()
      `, [userId, subj.id, kurs]);
      if (subj.key === 'mathe') {
        // users.kurs bleibt gespiegelt - bestehende Mathe-Lerntheken-Logik (Aufbau-Filter etc.)
        // liest ausschließlich von dort und muss dafür nicht umgebaut werden.
        await pool.query('UPDATE users SET kurs=$1 WHERE id=$2', [kurs, userId]);
      }
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// ── Admin: Schüler:in passiv/aktiv setzen (verschwindet aus Übersichten/Ranglisten/
// Klassenkameraden, bleibt aber in der Klassen-Übersicht sichtbar und reaktivierbar) ──
app.post('/api/admin/set-aktiv', requireAdmin, async (req, res) => {
  try {
    const { userId, aktiv } = req.body;
    if (typeof aktiv !== 'boolean') return res.status(400).json({ error: 'Ungültig' });
    const u = await pool.query('SELECT id FROM users WHERE id=$1 AND klasse=$2 AND role=$3', [userId, req.session.klasse, 'student']);
    if (!u.rows.length) return res.status(403).json({ error: 'Nicht gefunden' });
    // passiv_seit merkt sich den Zeitpunkt: beim Passiv-Setzen wird er gesetzt (ein bereits
    // vorhandener Stempel bleibt stehen), beim Reaktivieren wieder geleert.
    await pool.query(
      `UPDATE users SET aktiv=$1, passiv_seit = CASE WHEN $1 THEN NULL ELSE COALESCE(passiv_seit, NOW()) END
       WHERE id=$2`,
      [aktiv, userId]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// ── Mathe-Talks ───────────────────────────────────────────────────────────────
// Schüler/geteilt
app.get('/api/classmates', requireLogin, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT id, username, created_at AS "createdAt" FROM users WHERE role=$1 AND klasse=$2 AND id != $3 AND aktiv=true ORDER BY username',
      ['student', req.session.klasse, req.session.userId]
    );
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

app.get('/api/talking-slots/open', requireLogin, async (req, res) => {
  try {
    const typ = req.query.typ === 'input' ? 'input' : 'talk';
    const subjectKey = req.query.subject || 'mathe';
    const r = await pool.query(`
      SELECT s.id, s.datum, s.uhrzeit, s.ort, s.halbjahr, s.typ, s.dauer, s.subject_id AS "subjectId",
             s.thema AS "slotThema"
      FROM talking_slots s
      JOIN subjects sub ON sub.id = s.subject_id
      WHERE s.klasse=$1 AND s.typ=$2 AND sub.key=$3 AND s.datum >= CURRENT_DATE
        AND sub.nur_zugewiesen = false AND s.geschlossen = false
        AND NOT EXISTS (SELECT 1 FROM talking_sessions ts WHERE ts.slot_id=s.id)
      ORDER BY s.datum, s.uhrzeit
    `, [req.session.klasse, typ, subjectKey]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

app.get('/api/talking-sessions/mine', requireLogin, async (req, res) => {
  try {
    const uid = req.session.userId;
    const subjectKey = req.query.subject || 'mathe';
    const [subjRes, targetRows, meRow] = await Promise.all([
      pool.query('SELECT id, pflicht_praesentieren AS "pflichtP", pflicht_zuhoeren AS "pflichtZ" FROM subjects WHERE key=$1', [subjectKey]),
      pool.query('SELECT subject_id, halbjahr, pflicht_praesentieren, pflicht_zuhoeren FROM subject_halbjahr_targets'),
      pool.query('SELECT created_at, passiv_seit FROM users WHERE id=$1', [uid]),
    ]);
    if (!subjRes.rows.length) return res.status(400).json({ error: 'Ungültiges Fach' });
    const subject = subjRes.rows[0];
    const myCreatedAt = meRow.rows[0] ? meRow.rows[0].created_at : null;
    const myPassivSeit = meRow.rows[0] ? meRow.rows[0].passiv_seit : null;
    const [presenting, invitations, slotHalbjahre, fabue] = await Promise.all([
      pool.query(`
        SELECT ts.id, ts.thema, ts.presented_status AS "presentedStatus", ts.pokale, ts.quality_emoji AS "qualityEmoji",
               sl.datum, sl.uhrzeit, sl.ort, sl.halbjahr,
               COALESCE(json_agg(json_build_object(
                 'id', ti.id, 'listenerId', u.id, 'username', u.username,
                 'status', ti.status, 'herkunft', ti.herkunft, 'gesehen', ti.gesehen_am IS NOT NULL,
                 'attendedStatus', ti.attended_status,
                 'pokale', ti.pokale, 'qualityEmoji', ti.quality_emoji
               )) FILTER (WHERE ti.id IS NOT NULL), '[]') AS invitees
        FROM talking_sessions ts
        JOIN talking_slots sl ON sl.id = ts.slot_id
        LEFT JOIN talking_invitations ti ON ti.session_id = ts.id
        LEFT JOIN users u ON u.id = ti.listener_id
        WHERE ts.presenter_id = $1 AND sl.typ = 'talk' AND sl.subject_id = $2
        GROUP BY ts.id, sl.id
        ORDER BY sl.datum DESC, sl.uhrzeit
      `, [uid, subject.id]),
      pool.query(`
        SELECT ti.id, ti.status, ti.herkunft, (ti.gesehen_am IS NOT NULL) AS gesehen,
               ti.attended_status AS "attendedStatus", ti.pokale, ti.quality_emoji AS "qualityEmoji",
               ts.id AS session_id, ts.thema, ts.presented_status AS "presentedStatus",
               sl.datum, sl.uhrzeit, sl.ort, sl.halbjahr,
               pu.username AS presenter_username
        FROM talking_invitations ti
        JOIN talking_sessions ts ON ts.id = ti.session_id
        JOIN talking_slots sl ON sl.id = ts.slot_id
        JOIN users pu ON pu.id = ts.presenter_id
        WHERE ti.listener_id = $1 AND sl.typ = 'talk' AND sl.subject_id = $2
        ORDER BY sl.datum DESC, sl.uhrzeit
      `, [uid, subject.id]),
      pool.query(`SELECT DISTINCT halbjahr FROM talking_slots WHERE klasse=$1 AND typ='talk' AND subject_id=$2`, [req.session.klasse, subject.id]),
      // Fachbüro-Termine BEWUSST getrennt von presenting/invitations: die beiden filtern hart
      // typ='talk', weil Fachbüros weder Flammen noch Pflicht-Vorgaben haben und die
      // Halbjahr-Rechnung sonst verfälschen würden. Für die Übersicht der Schüler:innen
      // sollen die Teilnahmen aber trotzdem sichtbar sein - deshalb dieses eigene Feld.
      // Nur zurückliegende Termine: ein noch bevorstehendes Fachbüro ist keine Teilnahme
      // (dieselbe Regel wie in halbjahrOverview()).
      pool.query(`
        SELECT to_char(sl.datum,'YYYY-MM-DD') AS datum, sl.halbjahr, sl.uhrzeit, sl.ort,
               ts.thema, ts.presented_status AS status, 'selbst gebucht' AS rolle
        FROM talking_sessions ts JOIN talking_slots sl ON sl.id = ts.slot_id
        WHERE ts.presenter_id = $1 AND sl.typ = 'input' AND sl.subject_id = $2 AND sl.datum <= CURRENT_DATE
        UNION ALL
        SELECT to_char(sl.datum,'YYYY-MM-DD') AS datum, sl.halbjahr, sl.uhrzeit, sl.ort,
               ts.thema, ti.attended_status AS status, 'angemeldet' AS rolle
        FROM talking_invitations ti
        JOIN talking_sessions ts ON ts.id = ti.session_id
        JOIN talking_slots sl ON sl.id = ts.slot_id
        WHERE ti.listener_id = $1 AND sl.typ = 'input' AND sl.subject_id = $2 AND sl.datum <= CURRENT_DATE
        ORDER BY datum DESC
      `, [uid, subject.id]),
    ]);

    const accepted = invitations.rows.filter(i => i.status === 'angenommen');
    // Halbjahre vor der Account-Erstellung und nach dem Passiv-Setzen zählen nicht mit - sonst
    // hätte eine später dazugekommene Person von Anfang an ein unerreichbares Pflicht-Maximum,
    // und bei einer passiv gesetzten Person würde es mit jedem neuen Halbjahr weiterwachsen.
    const myHalbjahre = slotHalbjahre.rows.map(r => r.halbjahr)
      .filter(hj => halbjahrCountsForUser(hj, myCreatedAt, myPassivSeit));
    const trophies = computeTalkingTrophies(myHalbjahre, presenting.rows, accepted,
      buildTargetsResolver(subject, targetRows.rows));

    res.json({
      presenting: presenting.rows,
      invitations: invitations.rows,
      fabue: fabue.rows,
      trophies
    });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// Bucht einen offenen Termin: legt Session + Einladungen in einer Transaktion an,
// damit nie eine Session ohne eingeladene Personen übrig bleibt (die zweite Transaktion im Projekt
// ist lzkUnterSperre - LZK anlegen ohne Doppelte).
app.post('/api/talking-sessions', requireLogin, async (req, res) => {
  const { slotId, thema, inviteeIds } = req.body;
  if (!slotId) return res.status(400).json({ error: 'Fehlende Angaben' });
  const ids = [...new Set((Array.isArray(inviteeIds) ? inviteeIds : []).map(Number))].filter(id => id && id !== req.session.userId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const slotCheck = await client.query(
      `SELECT sl.id, sl.typ, sl.thema, sl.geschlossen, COALESCE(sub.nur_zugewiesen, false) AS "nurZugewiesen",
              (sl.datum < CURRENT_DATE) AS vorbei
       FROM talking_slots sl LEFT JOIN subjects sub ON sub.id = sl.subject_id
       WHERE sl.id=$1 AND sl.klasse=$2`,
      [slotId, req.session.klasse]
    );
    if (!slotCheck.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Termin nicht gefunden' });
    }
    // Lernberatung & Co. vergibt ausschliesslich die Lernbegleitung.
    if (slotCheck.rows[0].nurZugewiesen && req.session.role !== 'admin') {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Diesen Termin vergibt die Lernbegleitung.' });
    }
    // Fuer weitere Anmeldungen geschlossen - die Lernbegleitung darf weiterhin eintragen.
    if (slotCheck.rows[0].geschlossen && req.session.role !== 'admin') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Dieser Termin nimmt keine weiteren Anmeldungen mehr an.' });
    }
    // Vergangene Termine sind fuer Schueler:innen zu - nachtraeglich buchen ergibt keinen
    // Sinn. Nachpflegen darf das nur die Lernbegleitung.
    if (slotCheck.rows[0].vorbei && req.session.role !== 'admin') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Dieser Termin ist vorbei - sprich die Lernbegleitung an, wenn du nachgetragen werden willst.' });
    }
    // Ein ausgeschriebenes Thema gehört der Lernbegleitung - eine Buchung darf es nicht
    // überschreiben. Bei einem Fachbüro mit Thema wird deshalb gar nicht mehr gebucht,
    // sondern angefragt (POST /api/talking-slots/:id/request). Ein eigenes Thema setzen
    // Schüler:innen nur auf komplett freien Terminen.
    const slotThema = (slotCheck.rows[0].thema || '').trim();
    if (slotThema && (slotCheck.rows[0].typ || 'talk') === 'input' && req.session.role !== 'admin') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Für dieses Fachbüro hat die Lernbegleitung schon ein Thema gesetzt - frage an, ob du mitmachen darfst.' });
    }
    const sessionThema = slotThema || (thema || '').trim();
    if (!sessionThema) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Fehlende Angaben' });
    }
    // Talks brauchen mind. 1 eingeladene Person; Input ist Solo-buchbar (0 Eingeladene erlaubt).
    if ((slotCheck.rows[0].typ || 'talk') === 'talk' && !ids.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Mindestens eine eingeladene Person nötig' });
    }
    // Überschneidungsschutz: der/die Buchende darf zu dieser Zeit nicht schon belegt sein.
    if (await hasScheduleConflict(req.session.userId, slotId)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Zeitkonflikt: Du hast zu dieser Uhrzeit bereits einen anderen Termin.' });
    }
    if (ids.length) {
      const validInvitees = await client.query(
        'SELECT id FROM users WHERE id = ANY($1) AND role=$2 AND klasse=$3',
        [ids, 'student', req.session.klasse]
      );
      if (validInvitees.rows.length !== ids.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Ungültige eingeladene Person' });
      }
    }
    const sessionResult = await client.query(
      'INSERT INTO talking_sessions (slot_id, presenter_id, thema) VALUES ($1,$2,$3) RETURNING id',
      [slotId, req.session.userId, sessionThema]
    );
    const sessionId = sessionResult.rows[0].id;
    for (const listenerId of ids) {
      await client.query(
        'INSERT INTO talking_invitations (session_id, listener_id) VALUES ($1,$2)',
        [sessionId, listenerId]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true, sessionId });
  } catch(e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(409).json({ error: 'Termin bereits gebucht' });
    res.status(500).json({ error: 'Serverfehler' });
  } finally {
    client.release();
  }
});

app.post('/api/talking-sessions/:id/invite', requireLogin, async (req, res) => {
  try {
    const { inviteeIds } = req.body;
    if (!Array.isArray(inviteeIds) || !inviteeIds.length)
      return res.status(400).json({ error: 'Fehlende Angaben' });
    const session = await pool.query(
      'SELECT id, presented_status FROM talking_sessions WHERE id=$1 AND presenter_id=$2',
      [req.params.id, req.session.userId]
    );
    if (!session.rows.length) return res.status(404).json({ error: 'Nicht gefunden' });
    if (session.rows[0].presented_status !== 'ausstehend')
      return res.status(409).json({ error: 'Vortrag bereits bewertet, keine Einladungen mehr möglich' });
    const ids = [...new Set(inviteeIds.map(Number))].filter(id => id && id !== req.session.userId);
    if (!ids.length) return res.status(400).json({ error: 'Fehlende Angaben' });
    const validInvitees = await pool.query(
      'SELECT id FROM users WHERE id = ANY($1) AND role=$2 AND klasse=$3',
      [ids, 'student', req.session.klasse]
    );
    if (validInvitees.rows.length !== ids.length)
      return res.status(400).json({ error: 'Ungültige eingeladene Person' });
    for (const listenerId of ids) {
      await pool.query(
        'INSERT INTO talking_invitations (session_id, listener_id) VALUES ($1,$2) ON CONFLICT (session_id, listener_id) DO NOTHING',
        [req.params.id, listenerId]
      );
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// Presenter lädt eine bereits eingeladene Person wieder aus (solange noch nichts bewertet wurde).
app.delete('/api/talking-invitations/:id', requireLogin, async (req, res) => {
  try {
    const inv = await pool.query(
      `SELECT ti.id, ti.attended_status, ts.presented_status, ts.presenter_id
       FROM talking_invitations ti JOIN talking_sessions ts ON ts.id = ti.session_id
       WHERE ti.id=$1`,
      [req.params.id]
    );
    if (!inv.rows.length) return res.status(404).json({ error: 'Nicht gefunden' });
    const row = inv.rows[0];
    if (row.presenter_id !== req.session.userId) return res.status(403).json({ error: 'Kein Zugriff' });
    if (row.presented_status !== 'ausstehend')
      return res.status(409).json({ error: 'Vortrag bereits bewertet, Einladungen können nicht mehr geändert werden' });
    if (row.attended_status !== 'ausstehend')
      return res.status(409).json({ error: 'Teilnahme bereits bewertet, kann nicht mehr entfernt werden' });
    await pool.query('DELETE FROM talking_invitations WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// Admin entfernt nachträglich eine Person aus einem Talk (Zuhören) oder Input (Teilnahme) - z.B.
// wenn jemand versehentlich zugewiesen wurde. Gleiche Bewertungs-Guards wie beim Presenter-Auslad-
// Endpunkt oben, zusätzlich auf die eigene Klasse gescoped (Admins verwalten nur ihre Klasse).
app.delete('/api/admin/talking-invitations/:id', requireAdmin, async (req, res) => {
  try {
    const inv = await pool.query(
      `SELECT ti.id, ti.attended_status, ts.id AS "sessionId", ts.presented_status, sl.klasse, sl.typ
       FROM talking_invitations ti
       JOIN talking_sessions ts ON ts.id = ti.session_id
       JOIN talking_slots sl ON sl.id = ts.slot_id
       WHERE ti.id=$1`,
      [req.params.id]
    );
    if (!inv.rows.length) return res.status(404).json({ error: 'Nicht gefunden' });
    const row = inv.rows[0];
    if (row.klasse !== req.session.klasse) return res.status(403).json({ error: 'Kein Zugriff' });
    // Der Schutz "schon bewertet" gilt nur fuer TALKS: dort haengen an der Bewertung
    // Flammen, die beim Loeschen lautlos verschwaenden. Am Fachbuero gibt es keine
    // Flammen - der Haken ist reine Anwesenheit und muss korrigierbar bleiben, auch
    // wenn schon "da gewesen" oder "gefehlt" eingetragen ist.
    if ((row.typ || 'talk') !== 'input') {
      if (row.presented_status !== 'ausstehend')
        return res.status(409).json({ error: 'Vortrag bereits bewertet, Teilnahme kann nicht mehr entfernt werden' });
      if (row.attended_status !== 'ausstehend')
        return res.status(409).json({ error: 'Teilnahme bereits bewertet, kann nicht mehr entfernt werden' });
    }
    await pool.query('DELETE FROM talking_invitations WHERE id=$1', [req.params.id]);
    // Ohne vortragende Person und ohne verbliebene Teilnehmende hängt am Termin nichts
    // mehr - dann wird er wieder frei, statt als leere Buchung stehen zu bleiben.
    await dropEmptySession(row.sessionId);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// Annehmen/Ablehnen geht nur, solange die TS des Presenters noch nicht bewertet wurde (presented_status
// 'ausstehend'). Danach entscheidet ausschließlich die Zuhören-Bewertung der Lernbegleitung (attended_status),
// ob die Person teilgenommen hat - das nachträgliche Ablehnen einer bereits stattgefundenen TS ergibt keinen Sinn.
// Schüler:in fragt bei einem schon laufenden Input an ("darf ich mitmachen?"). Ergebnis ist eine
// talking_invitations-Zeile mit Status 'angefragt' - erst die Zusage der Lernbegleitung macht
// daraus eine echte Teilnahme ('angenommen'). Bewusst nur für Input: bei Talks lädt die
// vortragende Person ein, da gibt es keine offene Anfrage.
// Schüler:in fragt an, bei einem Fachbüro mitzumachen. Einstieg ist der SLOT, nicht die
// Session: Auch ein noch ungebuchter Termin kann bereits ein ausgeschriebenes Thema haben.
// Dann gehört das Thema der Lernbegleitung, gebucht wird er nicht mehr, und die Runde
// entsteht erst mit der ersten Anfrage - ohne vortragende Person, genau wie bei einer
// Zuweisung durch die Lernbegleitung.
app.post('/api/talking-slots/:id/request', requireLogin, async (req, res) => {
  try {
    if (req.session.role !== 'student') return res.status(403).json({ error: 'Nur Schüler:innen können anfragen' });
    const slotRes = await pool.query(`
      SELECT sl.id, sl.typ, sl.thema, sl.geschlossen, COALESCE(sub.nur_zugewiesen, false) AS "nurZugewiesen",
             (sl.datum < CURRENT_DATE) AS vorbei,
             ts.id AS "sessionId", ts.presenter_id AS "presenterId", ts.presented_status AS "presentedStatus"
      FROM talking_slots sl
      LEFT JOIN subjects sub ON sub.id = sl.subject_id
      LEFT JOIN talking_sessions ts ON ts.slot_id = sl.id
      WHERE sl.id=$1 AND sl.klasse=$2
    `, [req.params.id, req.session.klasse]);
    if (!slotRes.rows.length) return res.status(404).json({ error: 'Termin nicht gefunden' });
    const s = slotRes.rows[0];
    if ((s.typ || 'talk') !== 'input') return res.status(400).json({ error: 'Anfragen gibt es nur bei Fachbüro-Terminen' });
    // Zu einer Lernberatung meldet man sich nicht selbst an.
    if (s.nurZugewiesen) return res.status(403).json({ error: 'Diesen Termin vergibt die Lernbegleitung.' });
    if (s.geschlossen) return res.status(409).json({ error: 'Dieser Termin nimmt keine weiteren Anmeldungen mehr an.' });
    // Nach dem Termin gibt es nichts mehr anzufragen - wer doch da war, wird von der
    // Lernbegleitung nachgetragen.
    if (s.vorbei) return res.status(409).json({ error: 'Dieser Termin ist vorbei - sprich die Lernbegleitung an, wenn du nachgetragen werden willst.' });
    if (s.sessionId && s.presentedStatus !== 'ausstehend') return res.status(409).json({ error: 'Termin ist schon abgeschlossen' });
    if (s.presenterId === req.session.userId) return res.status(409).json({ error: 'Du hast diesen Termin selbst gebucht' });
    const slotThema = (s.thema || '').trim();
    // Ein ganz freier Termin (weder Thema noch Session) wird gebucht, nicht angefragt.
    if (!s.sessionId && !slotThema) return res.status(400).json({ error: 'Dieser Termin ist noch ganz frei - du kannst ihn direkt buchen.' });

    if (s.sessionId) {
      const existing = await pool.query(
        'SELECT status FROM talking_invitations WHERE session_id=$1 AND listener_id=$2',
        [s.sessionId, req.session.userId]
      );
      if (existing.rows.length) {
        const st = existing.rows[0].status;
        return res.status(409).json({ error: st === 'angefragt' ? 'Deine Anfrage läuft schon' : 'Du bist bei diesem Termin schon eingetragen' });
      }
    }
    // Früh prüfen, damit niemand eine Anfrage stellt, die ohnehin kollidiert - beim Zusagen
    // wird nochmal geprüft, weil sich bis dahin etwas geändert haben kann.
    if (await hasScheduleConflict(req.session.userId, s.id))
      return res.status(409).json({ error: 'Zeitkonflikt: Du hast zu dieser Uhrzeit schon einen Termin' });

    let sessionId = s.sessionId;
    if (!sessionId) {
      // slot_id ist UNIQUE: fragen zwei Personen gleichzeitig an, gewinnt ein INSERT und das
      // andere bekommt über den Konflikt dieselbe Session-ID zurück (statt eines 500ers).
      const ins = await pool.query(
        `INSERT INTO talking_sessions (slot_id, presenter_id, thema) VALUES ($1,NULL,$2)
         ON CONFLICT (slot_id) DO UPDATE SET slot_id = EXCLUDED.slot_id RETURNING id`,
        [s.id, slotThema]
      );
      sessionId = ins.rows[0].id;
    }
    await pool.query(
      `INSERT INTO talking_invitations (session_id, listener_id, status) VALUES ($1,$2,'angefragt')
       ON CONFLICT (session_id, listener_id) DO NOTHING`,
      [sessionId, req.session.userId]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// Lernbegleitung entscheidet über eine Anfrage: zusagen (-> 'angenommen') oder ablehnen
// (Zeile wird gelöscht, damit die Person bei Bedarf erneut anfragen kann).
app.post('/api/admin/talking-invitations/:id/decide', requireAdmin, async (req, res) => {
  try {
    const { accept } = req.body;
    if (typeof accept !== 'boolean') return res.status(400).json({ error: 'Ungültig' });
    const inv = await pool.query(`
      SELECT ti.id, ti.status, ti.listener_id AS "listenerId", ts.id AS "sessionId", ts.slot_id AS "slotId", lu.username
      FROM talking_invitations ti
      JOIN talking_sessions ts ON ts.id = ti.session_id
      JOIN talking_slots sl ON sl.id = ts.slot_id
      JOIN users lu ON lu.id = ti.listener_id
      WHERE ti.id=$1 AND sl.klasse=$2
    `, [req.params.id, req.session.klasse]);
    if (!inv.rows.length) return res.status(404).json({ error: 'Nicht gefunden' });
    const row = inv.rows[0];
    if (row.status !== 'angefragt') return res.status(409).json({ error: 'Das ist keine offene Anfrage' });

    if (!accept) {
      await pool.query('DELETE FROM talking_invitations WHERE id=$1', [req.params.id]);
      // War das die einzige Anfrage an einem nur ausgeschriebenen Fachbüro, ist der Termin
      // danach wieder frei - sonst blockierte ihn eine abgelehnte Anfrage dauerhaft.
      await dropEmptySession(row.sessionId);
      return res.json({ ok: true, accepted: false });
    }
    if (await hasScheduleConflict(row.listenerId, row.slotId))
      return res.status(409).json({ error: `Zeitkonflikt: ${row.username} hat zu dieser Uhrzeit inzwischen einen anderen Termin` });
    await pool.query(`UPDATE talking_invitations SET status='angenommen', updated_at=NOW() WHERE id=$1`, [req.params.id]);
    res.json({ ok: true, accepted: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// Schüler:in zieht die eigene, noch offene Mitmach-Anfrage zurück. Die Zeile wird
// gelöscht statt auf 'abgelehnt' gesetzt - genau wie beim Ablehnen durch die
// Lernbegleitung, damit man später erneut anfragen kann.
app.post('/api/talking-invitations/:id/withdraw', requireLogin, async (req, res) => {
  try {
    const inv = await pool.query(`
      SELECT ti.id, ti.status, ts.id AS "sessionId"
      FROM talking_invitations ti
      JOIN talking_sessions ts ON ts.id = ti.session_id
      JOIN talking_slots sl ON sl.id = ts.slot_id
      WHERE ti.id=$1 AND ti.listener_id=$2 AND sl.klasse=$3
    `, [req.params.id, req.session.userId, req.session.klasse]);
    if (!inv.rows.length) return res.status(404).json({ error: 'Nicht gefunden' });
    // Nur die eigene ANFRAGE: eine Einladung wird beantwortet (respond), nicht zurückgezogen.
    if (inv.rows[0].status !== 'angefragt') return res.status(409).json({ error: 'Das ist keine offene Anfrage mehr' });
    await pool.query('DELETE FROM talking_invitations WHERE id=$1', [req.params.id]);
    // War das die einzige Anfrage an einem nur ausgeschriebenen Fachbüro, ist der
    // Termin danach wieder frei.
    await dropEmptySession(inv.rows[0].sessionId);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// Schüler:in nimmt einen ihr ZUGEWIESENEN Termin zur Kenntnis ("Alles klar").
// Das ist ausdrücklich KEINE Zusage - abgelehnt wird eine Zuweisung nicht, dafür gibt es
// das Gespräch. Es beantwortet nur die Frage, die sich die Lernbegleitung sonst selbst
// beantworten muss: "weiß die Person schon davon, oder muss ich sie noch ansprechen?"
app.post('/api/talking-invitations/:id/gesehen', requireLogin, async (req, res) => {
  try {
    const r = await pool.query(`
      UPDATE talking_invitations ti SET gesehen_am = NOW(), updated_at = NOW()
      FROM talking_sessions ts, talking_slots sl
      WHERE ti.session_id = ts.id AND ts.slot_id = sl.id
        AND ti.id = $1 AND ti.listener_id = $2 AND sl.klasse = $3
        AND ti.herkunft = 'zugewiesen' AND ti.gesehen_am IS NULL
      RETURNING ti.id
    `, [req.params.id, req.session.userId, req.session.klasse]);
    if (!r.rows.length) return res.status(404).json({ error: 'Nicht gefunden oder schon bestätigt' });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

app.post('/api/talking-invitations/:id/respond', requireLogin, async (req, res) => {
  try {
    const { accept } = req.body;
    // Zusagen nur ohne Zeitkonflikt: die Person darf zur Slot-Zeit nicht schon belegt sein.
    if (accept) {
      const slot = await pool.query(`
        SELECT ts.slot_id FROM talking_invitations ti
        JOIN talking_sessions ts ON ts.id = ti.session_id
        WHERE ti.id=$1 AND ti.listener_id=$2 AND ts.presented_status='ausstehend'
      `, [req.params.id, req.session.userId]);
      if (slot.rows.length && await hasScheduleConflict(req.session.userId, slot.rows[0].slot_id))
        return res.status(409).json({ error: 'Zeitkonflikt: Du hast zu dieser Uhrzeit bereits einen anderen Termin.' });
    }
    const status = accept ? 'angenommen' : 'abgelehnt';
    const r = await pool.query(`
      UPDATE talking_invitations ti SET status=$1, updated_at=NOW()
      FROM talking_sessions ts
      WHERE ti.session_id = ts.id AND ti.id=$2 AND ti.listener_id=$3 AND ts.presented_status='ausstehend'
      RETURNING ti.id
    `, [status, req.params.id, req.session.userId]);
    if (!r.rows.length) return res.status(409).json({ error: 'Dieser Mathe-Talk wurde bereits bewertet - Einladung kann nicht mehr beantwortet werden.' });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// Lernbegleitung. typ='talk' (default) oder 'input'; dauer in Minuten (Default 45).
app.post('/api/admin/talking-slots', requireAdmin, async (req, res) => {
  try {
    const { datum, uhrzeit, ort, halbjahr, recurring, typ, dauer, subjectId, teacherId, thema } = req.body;
    const slotTyp = typ === 'input' ? 'input' : 'talk';
    // Input-Slots brauchen kein Halbjahr (nicht in die Pokale-Zählung eingebunden).
    if (slotTyp === 'talk' && !halbjahr) return res.status(400).json({ error: 'Fehlende Angaben' });
    const slotDauer = Math.min(600, Math.max(5, parseInt(dauer) || 45));
    let subjId = subjectId;
    if (!subjId) {
      const mathe = await pool.query("SELECT id FROM subjects WHERE key='mathe'");
      subjId = mathe.rows[0].id;
    } else {
      const check = await pool.query('SELECT id FROM subjects WHERE id=$1', [subjId]);
      if (!check.rows.length) return res.status(400).json({ error: 'Ungültiges Fach' });
    }
    // Zugeordnete Lernbegleitung (admin_id) - Default die erstellende Person, überschreibbar auf einen
    // Mit-Admin derselben Klasse (z.B. wenn eine andere Lernbegleitung den Input tatsächlich hält).
    // Für Schüler:innen bei Input-Terminen sichtbar (siehe /api/calendar).
    let teacherUserId = req.session.userId;
    if (teacherId && Number(teacherId) !== req.session.userId) {
      const t = await pool.query('SELECT id FROM users WHERE id=$1 AND klasse=$2 AND role=$3', [teacherId, req.session.klasse, 'admin']);
      if (!t.rows.length) return res.status(400).json({ error: 'Ungültige Lernbegleitung' });
      teacherUserId = t.rows[0].id;
    }
    const dates = [];
    if (recurring) {
      const { weekday, von, bis } = recurring;
      if (weekday === undefined || weekday === null || !von || !bis)
        return res.status(400).json({ error: 'Fehlende Angaben' });
      let d = new Date(von + 'T00:00:00');
      const end = new Date(bis + 'T00:00:00');
      if (isNaN(d) || isNaN(end) || end < d) return res.status(400).json({ error: 'Ungültiger Zeitraum' });
      while (d <= end) {
        if (d.getDay() === Number(weekday)) dates.push(d.toISOString().slice(0, 10));
        d.setDate(d.getDate() + 1);
      }
      if (!dates.length) return res.status(400).json({ error: 'Kein passender Wochentag im Zeitraum' });
    } else {
      if (!datum) return res.status(400).json({ error: 'Fehlende Angaben' });
      dates.push(datum);
    }
    const neueIds = [];
    for (const d of dates) {
      const r = await pool.query(`
        INSERT INTO talking_slots (klasse, datum, uhrzeit, ort, halbjahr, admin_id, typ, dauer, subject_id, thema)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id
      `, [req.session.klasse, d, uhrzeit || '', ort || '', halbjahr || '', teacherUserId, slotTyp, slotDauer, subjId,
          (thema || '').trim()]);
      neueIds.push(r.rows[0].id);
    }
    // ids: damit der Aufrufer den erzeugten Termin weiterverwenden kann (z.B. einen
    // Wunsch daran haengen). Bei einer Serie ist der erste der frueheste.
    res.json({ ok: true, count: dates.length, ids: neueIds });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// Termin verschieben (Datum/Uhrzeit/Ort/Halbjahr) - egal ob schon gebucht oder nicht.
// Verhindert Terminkonflikte: kein zweiter Slot derselben Klasse am selben Datum+Uhrzeit.
app.post('/api/admin/talking-slots/:id/reschedule', requireAdmin, async (req, res) => {
  try {
    const { datum, uhrzeit, ort, halbjahr, dauer, thema } = req.body;
    if (!datum) return res.status(400).json({ error: 'Fehlende Angaben' });
    const may = await mayManageSlot(req, req.params.id);
    if (!may.ok) return res.status(may.status).json({ error: may.error });
    // Kollisionsprüfung nur gegen Termine DERSELBEN Lernbegleitung: mehrere Fachbüros
    // (Mathe/Englisch/Deutsch) laufen bewusst parallel zur selben Zeit. Verboten ist nur,
    // dass eine Person zwei eigene Termine gleichzeitig hat. Slots ohne zuständige Person
    // (Altbestand, admin_id NULL) werden übersprungen - da gibt es niemanden, der doppelt kann.
    // Für Schüler:innen greift davon unabhängig hasScheduleConflict() beim Buchen/Zuweisen.
    if (may.adminId != null) {
      const conflict = await pool.query(
        `SELECT id FROM talking_slots WHERE klasse=$1 AND datum=$2 AND uhrzeit=$3 AND id != $4 AND admin_id = $5`,
        [req.session.klasse, datum, uhrzeit || '', req.params.id, may.adminId]
      );
      if (conflict.rows.length)
        return res.status(409).json({ error: 'Terminkonflikt: Diese Lernbegleitung hat zu dieser Zeit bereits einen eigenen Termin.' });
    }
    const slotDauer = Math.min(600, Math.max(5, parseInt(dauer) || 45));
    const r = await pool.query(
      // Das Thema wird nur angefasst, wenn es mitgeschickt wurde - sonst wuerde ein
      // Dialog ohne Themafeld (Talk oder schon gebucht) das ausgeschriebene loeschen.
      `UPDATE talking_slots SET datum=$1, uhrzeit=$2, ort=$3, halbjahr=$4, dauer=$5,
              thema = CASE WHEN $8::boolean THEN $9 ELSE thema END
       WHERE id=$6 AND klasse=$7 RETURNING id`,
      [datum, uhrzeit || '', ort || '', halbjahr || '', slotDauer, req.params.id, req.session.klasse,
       thema !== undefined, (thema || '').trim()]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Nicht gefunden' });
    // Ein nachträglich geändertes Fachbüro-Thema muss auch in einer schon angelegten Session
    // ankommen (Zuweisung oder Anfrage, presenter_id IS NULL) - sonst stünde im Kalender
    // weiter der alte Titel. Selbst gebuchte Themen von Schüler:innen bleiben unangetastet.
    if (thema !== undefined && (thema || '').trim()) {
      await pool.query(
        `UPDATE talking_sessions SET thema=$1, updated_at=NOW() WHERE slot_id=$2 AND presenter_id IS NULL`,
        [(thema || '').trim(), req.params.id]
      );
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

app.get('/api/admin/talking-slots', requireAdmin, async (req, res) => {
  try {
    // Default 'talk'/'mathe' -> bestehende Mathe-Talks-Admin-Ansicht bleibt unverändert.
    const typ = req.query.typ === 'input' ? 'input' : 'talk';
    const subjectKey = req.query.subject || 'mathe';
    const r = await pool.query(`
      SELECT s.id, s.datum, s.uhrzeit, s.ort, s.halbjahr, s.typ, s.dauer, s.subject_id AS "subjectId",
             s.thema AS "slotThema", s.geschlossen,
             ts.id AS session_id, ts.thema, ts.presented_status AS "presentedStatus", ts.pokale, ts.quality_emoji AS "qualityEmoji", pu.username AS presenter_username,
             COALESCE(json_agg(json_build_object(
               'id', ti.id, 'listenerId', lu.id, 'username', lu.username,
               'status', ti.status, 'herkunft', ti.herkunft, 'gesehen', ti.gesehen_am IS NOT NULL,
               'attendedStatus', ti.attended_status,
               'pokale', ti.pokale, 'qualityEmoji', ti.quality_emoji
             )) FILTER (WHERE ti.id IS NOT NULL), '[]') AS invitees
      FROM talking_slots s
      JOIN subjects sub ON sub.id = s.subject_id
      LEFT JOIN talking_sessions ts ON ts.slot_id = s.id
      LEFT JOIN users pu ON pu.id = ts.presenter_id
      LEFT JOIN talking_invitations ti ON ti.session_id = ts.id
      LEFT JOIN users lu ON lu.id = ti.listener_id
      WHERE s.klasse=$1 AND s.typ=$2 AND sub.key=$3
      GROUP BY s.id, ts.id, pu.username
      ORDER BY s.datum DESC, s.uhrzeit
    `, [req.session.klasse, typ, subjectKey]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

app.delete('/api/admin/talking-slots/:id', requireAdmin, async (req, res) => {
  try {
    const may = await mayManageSlot(req, req.params.id);
    if (!may.ok) return res.status(may.status).json({ error: may.error });
    const booked = await pool.query('SELECT id FROM talking_sessions WHERE slot_id=$1', [req.params.id]);
    if (booked.rows.length) return res.status(409).json({ error: 'Termin ist bereits gebucht' });
    const r = await pool.query(
      'DELETE FROM talking_slots WHERE id=$1 AND klasse=$2 RETURNING id',
      [req.params.id, req.session.klasse]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// Admin erstellt eine Input-Session OHNE festen "Presenter" direkt und weist Schüler:innen zu
// (2026-08-06). Nutzt einen unbebuchten Slot; Terminkonflikte werden je Person geprüft, wer
// wegen Konflikt nicht zugewiesen wurde, kommt mit Grund in der Antwort zurück (kein Hard-Fail
// der ganzen Anfrage, damit konfliktfreie Personen trotzdem sofort zugewiesen werden).
app.post('/api/admin/talking-sessions', requireAdmin, async (req, res) => {
  try {
    const { slotId, thema, studentIds } = req.body;
    if (!slotId) return res.status(400).json({ error: 'Fehlende Angaben' });
    const slot = await pool.query('SELECT id, thema FROM talking_slots WHERE id=$1 AND klasse=$2', [slotId, req.session.klasse]);
    if (!slot.rows.length) return res.status(404).json({ error: 'Termin nicht gefunden' });
    // Ist am Termin schon ein Thema ausgeschrieben, muss es hier nicht wiederholt werden.
    const sessionThema = (thema || '').trim() || (slot.rows[0].thema || '').trim();
    if (!sessionThema) return res.status(400).json({ error: 'Fehlende Angaben' });
    const existing = await pool.query('SELECT id FROM talking_sessions WHERE slot_id=$1', [slotId]);
    if (existing.rows.length) return res.status(409).json({ error: 'Termin bereits gebucht' });

    const { okIds, conflicts } = await assignStudentsToSlot(req.session.klasse, slotId, studentIds);

    const sessionResult = await pool.query(
      'INSERT INTO talking_sessions (slot_id, presenter_id, thema) VALUES ($1,NULL,$2) RETURNING id',
      [slotId, sessionThema]
    );
    const sessionId = sessionResult.rows[0].id;
    for (const uid of okIds) {
      await pool.query(
        // herkunft='zugewiesen': die Person ist dabei, hat aber nie zugestimmt - sonst
        // stünde in der Liste "zugesagt", obwohl sie nichts davon weiß.
        `INSERT INTO talking_invitations (session_id, listener_id, status, herkunft)
         VALUES ($1,$2,'angenommen','zugewiesen')`,
        [sessionId, uid]
      );
    }
    res.json({ ok: true, sessionId, assigned: okIds.length, conflicts });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// Weitere Schüler:innen nachträglich zu einer bestehenden Session zuweisen (Talk oder Input),
// mit derselben Terminkonflikt-Prüfung + Feedback wie bei der Erstellung.
// Thema einer Buchung nachschaerfen (Lernbegleitung). Gesetzt hat es urspruenglich die
// buchende Person; die Lernbegleitung darf es praezisieren, ohne den Termin neu anzulegen.
// Die Berechtigung haengt am Termin, nicht an der Buchung - deshalb dieselbe Pruefung wie
// beim Verschieben (eigener Termin, oder Super-Admin).
// Ein Fachbuero fuer weitere Anmeldungen schliessen (oder wieder oeffnen). Der Termin
// bleibt bestehen; wer schon dabei ist, behaelt ihn. Nur Fachbueros - bei einem Talk
// gibt es nichts zu schliessen, der ist mit der Buchung ohnehin vergeben.
app.post('/api/admin/talking-slots/:id/geschlossen', requireAdmin, async (req, res) => {
  try {
    const geschlossen = req.body.geschlossen === true;
    const slot = await pool.query(
      'SELECT id, typ FROM talking_slots WHERE id=$1 AND klasse=$2',
      [req.params.id, req.session.klasse]
    );
    if (!slot.rows.length) return res.status(404).json({ error: 'Nicht gefunden' });
    if ((slot.rows[0].typ || 'talk') !== 'input')
      return res.status(400).json({ error: 'Nur Fachbüro-Termine lassen sich schließen.' });
    const may = await mayManageSlot(req, slot.rows[0].id);
    if (!may.ok) return res.status(may.status).json({ error: may.error });
    await pool.query('UPDATE talking_slots SET geschlossen=$1 WHERE id=$2', [geschlossen, slot.rows[0].id]);
    res.json({ ok: true, geschlossen });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

app.post('/api/admin/talking-sessions/:id/thema', requireAdmin, async (req, res) => {
  try {
    const thema = (req.body.thema || '').trim();
    if (!thema) return res.status(400).json({ error: 'Bitte ein Thema angeben.' });
    const sess = await pool.query(`
      SELECT ts.id, ts.slot_id AS "slotId"
      FROM talking_sessions ts JOIN talking_slots sl ON sl.id = ts.slot_id
      WHERE ts.id=$1 AND sl.klasse=$2
    `, [req.params.id, req.session.klasse]);
    if (!sess.rows.length) return res.status(404).json({ error: 'Nicht gefunden' });
    const may = await mayManageSlot(req, sess.rows[0].slotId);
    if (!may.ok) return res.status(may.status).json({ error: may.error });
    await pool.query(
      'UPDATE talking_sessions SET thema=$1, admin_id=$2, updated_at=NOW() WHERE id=$3',
      [thema, req.session.userId, sess.rows[0].id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

app.post('/api/admin/talking-sessions/:id/assign', requireAdmin, async (req, res) => {
  try {
    const { studentIds } = req.body;
    const sess = await pool.query(
      `SELECT ts.id, ts.slot_id AS "slotId" FROM talking_sessions ts
       JOIN talking_slots sl ON sl.id = ts.slot_id WHERE ts.id=$1 AND sl.klasse=$2`,
      [req.params.id, req.session.klasse]
    );
    if (!sess.rows.length) return res.status(404).json({ error: 'Nicht gefunden' });

    const { okIds, conflicts } = await assignStudentsToSlot(req.session.klasse, sess.rows[0].slotId, studentIds);
    for (const uid of okIds) {
      await pool.query(
        `INSERT INTO talking_invitations (session_id, listener_id, status, herkunft)
         VALUES ($1,$2,'angenommen','zugewiesen')
         ON CONFLICT (session_id, listener_id) DO NOTHING`,
        [req.params.id, uid]
      );
    }
    res.json({ ok: true, assigned: okIds.length, conflicts });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

app.post('/api/admin/talking-sessions/:id/confirm-presented', requireAdmin, async (req, res) => {
  try {
    const { status, pokale, qualityEmoji } = req.body;
    if (!TALKING_STATUS_VALUES.includes(status)) return res.status(400).json({ error: 'Ungültiger Status' });
    if (qualityEmoji && !TALKING_QUALITY_EMOJIS.includes(qualityEmoji))
      return res.status(400).json({ error: 'Ungültiges Emoji' });
    const pk = Math.min(3, Math.max(0, parseInt(pokale) || 0));
    const r = await pool.query(`
      UPDATE talking_sessions ts SET presented_status=$1, pokale=$2, quality_emoji=$3, admin_id=$4, updated_at=NOW()
      FROM talking_slots sl
      WHERE ts.slot_id = sl.id AND ts.id=$5 AND sl.klasse=$6
      RETURNING ts.id
    `, [status, pk, qualityEmoji || null, req.session.userId, req.params.id, req.session.klasse]);
    if (!r.rows.length) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

app.post('/api/admin/talking-invitations/:id/confirm-attended', requireAdmin, async (req, res) => {
  try {
    const { status, pokale, qualityEmoji } = req.body;
    if (!TALKING_STATUS_VALUES.includes(status)) return res.status(400).json({ error: 'Ungültiger Status' });
    if (qualityEmoji && !TALKING_QUALITY_EMOJIS.includes(qualityEmoji))
      return res.status(400).json({ error: 'Ungültiges Emoji' });
    const pk = Math.min(2, Math.max(0, parseInt(pokale) || 0));
    const r = await pool.query(`
      UPDATE talking_invitations ti SET attended_status=$1, pokale=$2, quality_emoji=$3, admin_id=$4, updated_at=NOW()
      FROM talking_sessions ts, talking_slots sl
      WHERE ti.session_id = ts.id AND ts.slot_id = sl.id AND ti.id=$5 AND sl.klasse=$6
      RETURNING ti.id
    `, [status, pk, qualityEmoji || null, req.session.userId, req.params.id, req.session.klasse]);
    if (!r.rows.length) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

app.delete('/api/admin/talking-sessions/:id', requireAdmin, async (req, res) => {
  try {
    // Buchung gehört zum Slot - deshalb entscheidet dessen Lernbegleitung über das Stornieren.
    const slotRow = await pool.query(`
      SELECT sl.id FROM talking_sessions ts JOIN talking_slots sl ON sl.id = ts.slot_id
      WHERE ts.id=$1 AND sl.klasse=$2
    `, [req.params.id, req.session.klasse]);
    if (!slotRow.rows.length) return res.status(404).json({ error: 'Nicht gefunden' });
    const may = await mayManageSlot(req, slotRow.rows[0].id);
    if (!may.ok) return res.status(may.status).json({ error: may.error });
    const r = await pool.query(`
      DELETE FROM talking_sessions ts USING talking_slots sl
      WHERE ts.slot_id = sl.id AND ts.id=$1 AND sl.klasse=$2
      RETURNING ts.id
    `, [req.params.id, req.session.klasse]);
    if (!r.rows.length) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// ── Deadlines (Termine der Lernbegleitung, klassenweit) ────────────────────────
app.post('/api/admin/deadlines', requireAdmin, async (req, res) => {
  try {
    const { datum, titel } = req.body;
    if (!datum || !titel || !titel.trim()) return res.status(400).json({ error: 'Fehlende Angaben' });
    const r = await pool.query(
      'INSERT INTO math_deadlines (klasse, datum, titel, admin_id) VALUES ($1,$2,$3,$4) RETURNING id',
      [req.session.klasse, datum, titel.trim(), req.session.userId]
    );
    res.json({ ok: true, id: r.rows[0].id });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

app.delete('/api/admin/deadlines/:id', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      'DELETE FROM math_deadlines WHERE id=$1 AND klasse=$2 RETURNING id',
      [req.params.id, req.session.klasse]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// ── Wunschliste ───────────────────────────────────────────────────────────────
// Schüler:innen tragen Themen ein, die sie sich als Fachbüro wünschen, und stimmen
// bei fremden Wünschen mit "ich auch" zu. Die Lernbegleitung sieht die Nachfrage
// und macht daraus einen Termin, zu dem alle Interessierten eingeladen werden.
//
// Namen der Interessierten bekommen NUR Admins: für Schüler:innen zählt die Zahl.
// Das nimmt den sozialen Druck raus, bei etwas mitzustimmen, weil bestimmte
// Leute dabei sind - und niemand braucht die Liste, um selbst zuzustimmen.
const WUNSCH_STATUS = ['offen', 'geplant', 'erledigt', 'abgelehnt'];

app.get('/api/wuensche', requireLogin, async (req, res) => {
  try {
    const uid = req.session.userId;
    const istAdmin = req.session.role === 'admin';
    const r = await pool.query(`
      SELECT w.id, w.titel, w.beschreibung, w.status, w.notiz, w.slot_id AS "slotId",
             to_char(w.created_at,'YYYY-MM-DD') AS erstellt,
             w.subject_id AS "subjectId", sub.name AS "subjectName", sub.color AS "subjectColor",
             u.username AS "vonUsername", (w.user_id = $2) AS "vonMir",
             (SELECT COUNT(*) FROM wunsch_interesse wi WHERE wi.wunsch_id = w.id)::int AS anzahl,
             EXISTS (SELECT 1 FROM wunsch_interesse wi WHERE wi.wunsch_id = w.id AND wi.user_id = $2) AS "ichDabei",
             COALESCE((SELECT json_agg(iu.username ORDER BY iu.username)
                       FROM wunsch_interesse wi JOIN users iu ON iu.id = wi.user_id
                       WHERE wi.wunsch_id = w.id), '[]') AS interessierte,
             to_char(sl.datum,'YYYY-MM-DD') AS "terminDatum", sl.uhrzeit AS "terminUhrzeit"
      FROM wunsch w
      LEFT JOIN subjects sub ON sub.id = w.subject_id
      LEFT JOIN users u ON u.id = w.user_id
      LEFT JOIN talking_slots sl ON sl.id = w.slot_id
      WHERE w.klasse = $1
      ORDER BY (w.status = 'offen') DESC, anzahl DESC, w.created_at DESC
    `, [req.session.klasse, uid]);
    // Wer den Wunsch gestellt hat und wer zugestimmt hat, sieht nur die Lernbegleitung.
    res.json(r.rows.map(w => istAdmin ? w
      : { ...w, interessierte: undefined, vonUsername: w.vonMir ? w.vonUsername : undefined }));
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

app.post('/api/wuensche', requireLogin, async (req, res) => {
  try {
    const titel = (req.body.titel || '').trim();
    const beschreibung = (req.body.beschreibung || '').trim();
    if (!titel) return res.status(400).json({ error: 'Bitte einen Titel angeben.' });
    if (titel.length > 120) return res.status(400).json({ error: 'Bitte kürzer fassen (max. 120 Zeichen).' });
    let subjId = parseInt(req.body.subjectId) || null;
    if (subjId) {
      const check = await pool.query('SELECT id FROM subjects WHERE id=$1', [subjId]);
      if (!check.rows.length) return res.status(400).json({ error: 'Ungültiges Fach' });
    } else {
      const mathe = await pool.query("SELECT id FROM subjects WHERE key='mathe'");
      subjId = mathe.rows[0] && mathe.rows[0].id;
    }
    const r = await pool.query(
      `INSERT INTO wunsch (klasse, subject_id, titel, beschreibung, user_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [req.session.klasse, subjId, titel, beschreibung, req.session.userId]
    );
    // Wer etwas vorschlägt, will es auch - sonst stünde da eine 0.
    await pool.query(
      `INSERT INTO wunsch_interesse (wunsch_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [r.rows[0].id, req.session.userId]
    );
    res.json({ ok: true, id: r.rows[0].id });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// "Ich auch" an- und abwählen. Nur solange der Wunsch offen ist: hängt schon ein
// Termin dran, wird über die Einladung entschieden, nicht mehr über die Liste.
app.post('/api/wuensche/:id/interesse', requireLogin, async (req, res) => {
  try {
    const w = await pool.query('SELECT id, status FROM wunsch WHERE id=$1 AND klasse=$2',
      [req.params.id, req.session.klasse]);
    if (!w.rows.length) return res.status(404).json({ error: 'Nicht gefunden' });
    if (w.rows[0].status !== 'offen') return res.status(409).json({ error: 'Dieser Wunsch ist schon abgehakt.' });
    const vorhanden = await pool.query(
      'SELECT 1 FROM wunsch_interesse WHERE wunsch_id=$1 AND user_id=$2', [req.params.id, req.session.userId]);
    if (vorhanden.rows.length) {
      await pool.query('DELETE FROM wunsch_interesse WHERE wunsch_id=$1 AND user_id=$2',
        [req.params.id, req.session.userId]);
    } else {
      await pool.query('INSERT INTO wunsch_interesse (wunsch_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [req.params.id, req.session.userId]);
    }
    const n = await pool.query('SELECT COUNT(*)::int AS n FROM wunsch_interesse WHERE wunsch_id=$1', [req.params.id]);
    res.json({ ok: true, dabei: !vorhanden.rows.length, anzahl: n.rows[0].n });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// Eigener Wunsch zurückziehen, solange er offen ist. Admins dürfen immer löschen.
app.delete('/api/wuensche/:id', requireLogin, async (req, res) => {
  try {
    const w = await pool.query('SELECT id, user_id, status FROM wunsch WHERE id=$1 AND klasse=$2',
      [req.params.id, req.session.klasse]);
    if (!w.rows.length) return res.status(404).json({ error: 'Nicht gefunden' });
    const meiner = w.rows[0].user_id === req.session.userId && w.rows[0].status === 'offen';
    if (!meiner && req.session.role !== 'admin') return res.status(403).json({ error: 'Kein Zugriff' });
    await pool.query('DELETE FROM wunsch WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

app.post('/api/admin/wuensche/:id/status', requireAdmin, async (req, res) => {
  try {
    const { status, notiz } = req.body;
    if (!WUNSCH_STATUS.includes(status)) return res.status(400).json({ error: 'Ungültiger Status' });
    const r = await pool.query(
      `UPDATE wunsch SET status=$1, notiz=$2, admin_id=$3, updated_at=NOW()
       WHERE id=$4 AND klasse=$5 RETURNING id`,
      [status, (notiz || '').trim(), req.session.userId, req.params.id, req.session.klasse]);
    if (!r.rows.length) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// Aus einem Wunsch wird ein Termin: der Slot ist schon angelegt (neu oder vorhanden),
// hier entsteht die Buchung und alle Interessierten werden eingeladen. Zeitkonflikte
// werden pro Person gemeldet, der Rest wird trotzdem eingetragen - dieselbe Regel
// wie beim Zuweisen von Hand.
app.post('/api/admin/wuensche/:id/termin', requireAdmin, async (req, res) => {
  try {
    const slotId = parseInt(req.body.slotId);
    if (!slotId) return res.status(400).json({ error: 'Fehlende Angaben' });
    const w = await pool.query('SELECT id, titel FROM wunsch WHERE id=$1 AND klasse=$2',
      [req.params.id, req.session.klasse]);
    if (!w.rows.length) return res.status(404).json({ error: 'Wunsch nicht gefunden' });
    const slot = await pool.query('SELECT id, thema FROM talking_slots WHERE id=$1 AND klasse=$2',
      [slotId, req.session.klasse]);
    if (!slot.rows.length) return res.status(404).json({ error: 'Termin nicht gefunden' });
    // Ein Wunsch darf nur an einen Termin gehaengt werden, den man auch aendern
    // duerfte - sonst belegt man den Termin einer anderen Lernbegleitung.
    const may = await mayManageSlot(req, slotId);
    if (!may.ok) return res.status(may.status).json({ error: may.error });

    const interessierte = await pool.query(
      `SELECT wi.user_id FROM wunsch_interesse wi JOIN users u ON u.id = wi.user_id
       WHERE wi.wunsch_id=$1 AND u.role='student' AND u.klasse=$2 AND u.aktiv=true`,
      [req.params.id, req.session.klasse]);
    const ids = interessierte.rows.map(r => r.user_id);
    const { okIds, conflicts } = await assignStudentsToSlot(req.session.klasse, slotId, ids);

    // Buchung: entweder es gibt schon eine (dann nur ergänzen) oder sie entsteht hier.
    const vorhanden = await pool.query('SELECT id FROM talking_sessions WHERE slot_id=$1', [slotId]);
    let sessionId;
    if (vorhanden.rows.length) {
      sessionId = vorhanden.rows[0].id;
    } else {
      const thema = (slot.rows[0].thema || '').trim() || w.rows[0].titel;
      const neu = await pool.query(
        'INSERT INTO talking_sessions (slot_id, presenter_id, thema) VALUES ($1,NULL,$2) RETURNING id',
        [slotId, thema]);
      sessionId = neu.rows[0].id;
      // Haengt der Wunsch an einem Termin, der noch ohne Thema ausgeschrieben war,
      // bekommt der Termin selbst den Titel - sonst stuende er in der Wochenansicht
      // weiterhin ohne Thema da.
      if (!(slot.rows[0].thema || '').trim()) {
        await pool.query('UPDATE talking_slots SET thema=$1 WHERE id=$2', [w.rows[0].titel, slotId]);
      }
    }
    for (const uid of okIds) {
      await pool.query(
        `INSERT INTO talking_invitations (session_id, listener_id, status) VALUES ($1,$2,'angenommen')
         ON CONFLICT (session_id, listener_id) DO NOTHING`,
        [sessionId, uid]);
    }
    await pool.query(
      `UPDATE wunsch SET status='geplant', slot_id=$1, admin_id=$2, updated_at=NOW() WHERE id=$3`,
      [slotId, req.session.userId, req.params.id]);
    res.json({ ok: true, eingeladen: okIds.length, conflicts });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// ── Kalender: alle Mathe-Termine der Klasse (Talks + Input + Deadlines) ─────────
// Klassenweit sichtbar (Lernbegleitung A sieht Slots von Lernbegleitung B). Pro Slot markiert,
// in welcher Rolle der/die anfragende User beteiligt ist (für Buchungs-/Antwort-Aktionen).
app.get('/api/calendar', requireLogin, async (req, res) => {
  try {
    const uid = req.session.userId;
    const [slots, deadlines, nurZugewiesen, lzkRows] = await Promise.all([
      pool.query(`
        SELECT s.id, s.typ, s.subject_id AS "subjectId", to_char(s.datum,'YYYY-MM-DD') AS datum, s.uhrzeit, s.dauer, s.ort, s.halbjahr,
               s.thema AS "slotThema", s.geschlossen,
               ts.id AS session_id, ts.thema, ts.presenter_id AS "presenterId", ts.presented_status AS "presentedStatus",
               pu.username AS "presenterUsername",
               tu.username AS "teacherUsername", s.admin_id AS "teacherId",
               (SELECT ti.id FROM talking_invitations ti WHERE ti.session_id = ts.id AND ti.listener_id = $2) AS "myInvitationId",
               (SELECT ti.status FROM talking_invitations ti WHERE ti.session_id = ts.id AND ti.listener_id = $2) AS "myInvitationStatus",
               (SELECT ti.herkunft FROM talking_invitations ti WHERE ti.session_id = ts.id AND ti.listener_id = $2) AS "myInvitationHerkunft",
               (SELECT ti.gesehen_am IS NOT NULL FROM talking_invitations ti WHERE ti.session_id = ts.id AND ti.listener_id = $2) AS "myInvitationGesehen",
               COALESCE(json_agg(json_build_object('id', inv.id, 'username', lu.username, 'status', inv.status,
                 'herkunft', inv.herkunft, 'gesehen', inv.gesehen_am IS NOT NULL, 'attendedStatus', inv.attended_status))
                 FILTER (WHERE inv.id IS NOT NULL), '[]') AS invitees
        FROM talking_slots s
        LEFT JOIN talking_sessions ts ON ts.slot_id = s.id
        LEFT JOIN users pu ON pu.id = ts.presenter_id
        LEFT JOIN users tu ON tu.id = s.admin_id
        LEFT JOIN talking_invitations inv ON inv.session_id = ts.id
        LEFT JOIN users lu ON lu.id = inv.listener_id
        WHERE s.klasse = $1
        GROUP BY s.id, ts.id, pu.username, tu.username
        ORDER BY s.datum, s.uhrzeit
      `, [req.session.klasse, uid]),
      pool.query(
        `SELECT id, to_char(datum,'YYYY-MM-DD') AS datum, titel FROM math_deadlines WHERE klasse=$1 ORDER BY datum`,
        [req.session.klasse]
      ),
      pool.query('SELECT id FROM subjects WHERE nur_zugewiesen = true'),
      // LZK: Schueler:innen nur die eigenen, Lernbegleitungen die ganze Lerngruppe -
      // sie sollen sehen, wer an welchem Tag eine LZK schreibt.
      req.session.role === 'admin'
        ? pool.query(`SELECT ${LZK_FELDER}, u.username FROM lzk l JOIN users u ON u.id = l.user_id
                      WHERE u.klasse=$1 AND u.role='student' AND u.aktiv=true`, [req.session.klasse])
        : pool.query(`SELECT ${LZK_FELDER} FROM lzk l WHERE l.user_id=$1`, [uid]),
    ]);
    const nurZugewiesenIds = new Set(nurZugewiesen.rows.map(r => r.id));
    const rows = slots.rows.map(s => ({
      ...s,
      booked: !!s.session_id,
      mineAsPresenter: s.presenterId === uid,
      mineAsListener: !!s.myInvitationId,
    })).filter(s => {
      // Serverseitig gefiltert, damit solche Termine gar nicht erst beim Browser
      // ankommen. Admins sehen weiterhin alles.
      if (req.session.role === 'admin') return true;
      // Wer schon dabei ist, behaelt seinen Termin in jedem Fall.
      if (s.mineAsPresenter || s.mineAsListener) return true;
      // Geschlossene Termine werden bewusst WEITER ausgeliefert: sie sollen in der
      // Wochenuebersicht stehen bleiben (man sieht, dass da etwas laeuft), nur eben
      // ohne Anmeldemoeglichkeit. Aus dem Tagesdetail fallen sie ueber die dortige
      // Regel "kein Knopf -> nicht auflisten" heraus.
      // Termine eines "nur zugewiesen"-Fachs (Lernberatung) vergibt die Lernbegleitung.
      return !nurZugewiesenIds.has(s.subjectId);
    });
    res.json({ slots: rows, deadlines: deadlines.rows, lzk: lzkRows.rows });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// ── Halbjahr-Übersicht (Aktivitäten/Erfolge je Schüler:in und Halbjahr) ────────
// Bucketet Talks/Input (nach Slot-Datum), LZK (nach lzk.datum) und Stationsabschlüsse
// (nach station_events.completed_at) ins Halbjahr. Stationen erst ab Einführung des
// Loggings vorhanden (kein Altbestand). Lerntheke-Gesamtstand kommt separat aus /api/admin/students.
async function halbjahrOverview(klasse, onlyUid) {
  const uidFilter = onlyUid ? ' AND u.id = $2' : '';
  const params = onlyUid ? [klasse, onlyUid] : [klasse];
  // In der Tandem-Übersicht auf passiv gesetzte Schüler:innen tauchen in dieser Übersicht
  // gar nicht auf - genau wie in der Lerntheken-Übersicht (Nutzer-Vorgabe, mehrfach bestätigt).
  // NICHT entfernen: ohne diesen Filter stehen passive Personen wieder in allen Halbjahren.
  // Der Selbst-Aufruf (/api/my-halbjahr, onlyUid gesetzt) bleibt bewusst ausgenommen, sonst
  // wäre die eigene Karte nach dem Passiv-Setzen leer.
  const aktivFilter = onlyUid ? '' : ' AND u.aktiv=true';
  const [students, presented, attended, lzkRows, stationRows, subjectsRows] = await Promise.all([
    // Kursung je Fach gleich mitnehmen: sie gehört zur Einordnung einer Auswertung
    // ("G-Kurs und noch nichts gemacht" liest sich anders als "E-Kurs").
    pool.query(`SELECT u.id, u.username, u.created_at, u.passiv_seit,
                       (SELECT json_object_agg(s.key, usk.kurs)
                        FROM user_subject_kurs usk JOIN subjects s ON s.id = usk.subject_id
                        WHERE usk.user_id = u.id) AS subject_kurs
                FROM users u WHERE u.role='student' AND u.klasse=$1${aktivFilter}${onlyUid ? ' AND u.id=$2' : ''} ORDER BY u.username`, params),
    pool.query(`
      SELECT ts.presenter_id AS uid, sl.typ, sl.halbjahr, sl.subject_id AS "subjectId", to_char(sl.datum,'YYYY-MM-DD') AS datum, ts.presented_status AS status, ts.thema, ts.pokale
      FROM talking_sessions ts JOIN talking_slots sl ON sl.id = ts.slot_id
      JOIN users u ON u.id = ts.presenter_id
      WHERE u.klasse = $1${uidFilter}
    `, params),
    pool.query(`
      SELECT ti.listener_id AS uid, sl.typ, sl.halbjahr, sl.subject_id AS "subjectId", to_char(sl.datum,'YYYY-MM-DD') AS datum, ti.attended_status AS status, ts.thema, pu.username AS presenter, ti.pokale
      FROM talking_invitations ti
      JOIN talking_sessions ts ON ts.id = ti.session_id
      JOIN talking_slots sl ON sl.id = ts.slot_id
      JOIN users u ON u.id = ti.listener_id
      -- LEFT JOIN: ein von der Lernbegleitung angelegtes Fachbuero hat keine
      -- vortragende Person (presenter_id IS NULL). Mit INNER JOIN fielen genau
      -- diese Teilnahmen lautlos aus der Auswertung.
      LEFT JOIN users pu ON pu.id = ts.presenter_id
      WHERE u.klasse = $1${uidFilter}
    `, params),
    pool.query(`
      SELECT l.user_id AS uid, l.lerntheke, l.typ, l.status, l.pokale, to_char(l.datum,'YYYY-MM-DD') AS datum,
             l.subject_id AS "subjectId", l.thema
      FROM lzk l JOIN users u ON u.id = l.user_id
      WHERE u.klasse = $1 AND l.datum IS NOT NULL AND l.anfrage IS NULL${uidFilter}
    `, params),
    pool.query(`
      SELECT se.user_id AS uid, se.progress_key, to_char(se.completed_at,'YYYY-MM-DD') AS datum
      FROM station_events se JOIN users u ON u.id = se.user_id
      WHERE u.klasse = $1${uidFilter}
    `, params),
    pool.query(`SELECT id, key, name, color FROM subjects ORDER BY id`),
  ]);

  const subjectById = {};
  subjectsRows.rows.forEach(s => { subjectById[s.id] = s; });

  // Talks/Input werden dem ZUGEWIESENEN Halbjahr des Slots zugeordnet (talking_slots.halbjahr,
  // von der Lernbegleitung gesetzt - so zählt auch das Pokale-System). Input-Slots haben kein Halbjahr
  // -> Fallback aufs Datum. LZK/Stationen haben kein Halbjahr-Feld -> immer aus dem Datum.
  const slotHj = (r) => (r.halbjahr && String(r.halbjahr).trim()) ? String(r.halbjahr).trim() : halbjahrForDate(r.datum);
  const maxD = (a, b) => (!a ? b : !b ? a : (a > b ? a : b));
  const byUser = {};
  // Talks/Input werden zusätzlich nach Fach getrennt (bySubject) - LZK/Stationen bleiben fach-
  // unabhängig auf HJ-Ebene (die Lerntheken/LZK gibt es aktuell nur für Mathe).
  const ensure = (uid, hj) => {
    if (!byUser[uid]) byUser[uid] = {};
    if (!byUser[uid][hj]) byUser[uid][hj] = {
      stationsCompleted: 0, lzk: [], stationDetails: [],
      lastLzk: null, lastStation: null, lastActivity: null,
      bySubject: {},
    };
    return byUser[uid][hj];
  };
  const ensureSubject = (uid, hj, subjectId) => {
    const hjRow = ensure(uid, hj);
    const subj = subjectById[subjectId];
    const key = subj ? subj.key : 'unbekannt';
    if (!hjRow.bySubject[key]) hjRow.bySubject[key] = {
      subjectName: subj ? subj.name : 'Unbekannt', subjectColor: subj ? subj.color : '#94a3b8',
      talksPresented: 0, talksListened: 0, inputParticipated: 0, pokalePresented: 0, pokaleListened: 0,
      // Anwesenheit im Fachbuero: teilgenommen (inputParticipated = bestaetigt),
      // gefehlt, offen = Termin vorbei aber noch nicht eingetragen, und
      // upcoming = Termin steht noch bevor (angemeldet, aber noch keine Teilnahme).
      inputMissed: 0, inputOpen: 0, inputUpcoming: 0,
      talkDetails: [], inputDetails: [], lastTalk: null, lastInput: null,
    };
    return hjRow.bySubject[key];
  };
  const halbjahre = new Set();

  const heuteIso = new Date().toISOString().slice(0, 10);
  // Fachbuero-Termine zaehlen nicht nur, wenn jemand da war: ein vergangener
  // Termin ohne Eintrag ist "offen" und gehoert in die Auswertung, sonst faellt
  // eine unbewertete Teilnahme einfach unter den Tisch. Termine, die noch
  // bevorstehen, bleiben aussen vor - auch dann, wenn die Lernbegleitung den
  // Haken schon gesetzt hat: das ist bis zum Termin eine Zusage und noch keine
  // Teilnahme. Ab dem Tag des Termins zaehlt der Haken, "offen" wird ein Termin
  // erst am Tag danach (am Termintag selbst ist noch nichts ueberfaellig).
  const fabueGezaehlt = (s, r) => {
    if (!r.datum) return false;
    if (r.datum <= heuteIso) {
      if (r.status === 'erledigt') { s.inputParticipated++; return true; }
      if (r.status === 'nicht_erledigt') { s.inputMissed++; return true; }
    }
    if (r.datum < heuteIso) { s.inputOpen++; return true; }
    // Termin steht noch bevor: zaehlt NICHT als Teilnahme, gehoert aber trotzdem in
    // die Liste - sonst sieht die Lernbegleitung nicht, wer schon angemeldet ist.
    s.inputUpcoming++;
    return true;
  };
  const fabueEintragen = (r, rolle, extra) => {
    const hj = slotHj(r); if (!hj) return;
    const s = ensureSubject(r.uid, hj, r.subjectId);
    if (!fabueGezaehlt(s, r)) return;
    halbjahre.add(hj);
    s.inputDetails.push({ datum: r.datum, role: rolle, thema: r.thema, status: r.status, ...extra });
    s.lastInput = maxD(s.lastInput, r.datum);
  };

  presented.rows.forEach(r => {
    if (r.typ === 'input') return fabueEintragen(r, 'selbst gebucht', {});
    if (r.status !== 'erledigt') return;
    const hj = slotHj(r); if (!hj) return;
    halbjahre.add(hj);
    const s = ensureSubject(r.uid, hj, r.subjectId);
    s.talksPresented++; s.pokalePresented += r.pokale || 0;
    s.talkDetails.push({ datum: r.datum, role: 'gehalten', thema: r.thema, pokale: r.pokale });
    s.lastTalk = maxD(s.lastTalk, r.datum);
  });
  attended.rows.forEach(r => {
    // "angemeldet" statt "teilgenommen": die Rolle sagt nur, dass die Person auf der
    // Liste steht. Ob sie da war, steht daneben im Status - "teilgenommen · noch offen"
    // las sich wie ein Widerspruch.
    if (r.typ === 'input') return fabueEintragen(r, 'angemeldet', { presenter: r.presenter });
    if (r.status !== 'erledigt') return;
    const hj = slotHj(r); if (!hj) return;
    halbjahre.add(hj);
    const s = ensureSubject(r.uid, hj, r.subjectId);
    s.talksListened++; s.pokaleListened += r.pokale || 0;
    s.talkDetails.push({ datum: r.datum, role: 'zugehört', thema: r.thema, presenter: r.presenter, pokale: r.pokale });
    s.lastTalk = maxD(s.lastTalk, r.datum);
  });
  lzkRows.rows.forEach(r => {
    const hj = halbjahrForDate(r.datum); if (!hj) return;
    halbjahre.add(hj);
    const b = ensure(r.uid, hj);
    b.lzk.push({ lerntheke: r.lerntheke, typ: r.typ, status: r.status, pokale: r.pokale, datum: r.datum,
                 subjectId: r.subjectId, thema: r.thema });
    b.lastLzk = maxD(b.lastLzk, r.datum);
  });
  stationRows.rows.forEach(r => {
    const hj = halbjahrForDate(r.datum); if (!hj) return;
    halbjahre.add(hj);
    const b = ensure(r.uid, hj);
    b.stationsCompleted++;
    b.stationDetails.push({ datum: r.datum, progress_key: r.progress_key });
    b.lastStation = maxD(b.lastStation, r.datum);
  });

  Object.values(byUser).forEach(hjMap => Object.values(hjMap).forEach(b => {
    const subjDates = Object.values(b.bySubject).flatMap(s => [s.lastTalk, s.lastInput]);
    b.lastActivity = [...subjDates, b.lastLzk, b.lastStation].reduce((a, c) => maxD(a, c), null);
    b.lzk.sort((x, y) => (y.datum || '').localeCompare(x.datum || ''));
    b.stationDetails.sort((x, y) => y.datum.localeCompare(x.datum));
    Object.values(b.bySubject).forEach(s => {
      s.talkDetails.sort((x, y) => y.datum.localeCompare(x.datum));
      s.inputDetails.sort((x, y) => y.datum.localeCompare(x.datum));
    });
  }));

  return {
    halbjahre: [...halbjahre].sort().reverse(),
    subjects: subjectsRows.rows.map(s => ({ key: s.key, name: s.name, color: s.color })),
    // firstHalbjahr = Halbjahr der Account-Erstellung, lastHalbjahr = Halbjahr des Passiv-Setzens
    // (null solange aktiv). Das Frontend zeigt die Person nur in diesem Zeitraum an, statt sie
    // davor/danach als "nichts los" zu werten bzw. rückwirkend ganz verschwinden zu lassen.
    students: students.rows.map(s => ({
      id: s.id, username: s.username,
      firstHalbjahr: halbjahrForDate(s.created_at),
      lastHalbjahr: s.passiv_seit ? halbjahrForDate(s.passiv_seit) : null,
      subjectKurs: s.subject_kurs || {},
      byHalbjahr: byUser[s.id] || {},
    })),
  };
}

app.get('/api/admin/halbjahr-uebersicht', requireAdmin, async (req, res) => {
  try { res.json(await halbjahrOverview(req.session.klasse)); }
  catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

app.get('/api/my-halbjahr', requireLogin, async (req, res) => {
  try {
    const data = await halbjahrOverview(req.session.klasse, req.session.userId);
    const meRow = data.students[0] || { byHalbjahr: {}, subjectKurs: {} };
    res.json({ halbjahre: data.halbjahre, byHalbjahr: meRow.byHalbjahr,
               subjectKurs: meRow.subjectKurs || {} });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// ── Öffentliche Wochenübersicht (Login-Seite, OHNE Auth) ──────────────────────
// Zeigt die Termine der laufenden Woche (Mo-So) je Fach: wann, wo, welcher Typ und
// ob noch frei oder schon gebucht. BEWUSST OHNE NAMEN - die Seite ist ohne Login
// erreichbar, deshalb werden weder Presenter noch Eingeladene ausgegeben (nur der
// Boolean `booked`). Beim Erweitern dieser Route unbedingt namensfrei halten.
// Tandem vorerst fest; ein Selector auf der Login-Seite kann diese Konstante
// später durch einen validierten Query-Parameter ersetzen.
const PUBLIC_WEEK_KLASSE = 'M3M4';
// Montag der angezeigten Woche als 'YYYY-MM-DD'. Ab Samstag schon die KOMMENDE Woche -
// identische Regel wie lwMonday() in index.html und monday() in tag.html. Bewusst in JS
// gerechnet statt per date_trunc('week', CURRENT_DATE), damit die Regel an einer lesbaren
// Stelle steht und nicht zwischen SQL und Frontend auseinanderlaufen kann.
function publicWeekMonday() {
  const d = new Date(); d.setHours(0,0,0,0);
  const day = d.getDay();                       // 0 = So, 1 = Mo, ... 6 = Sa
  d.setDate(d.getDate() - ((day + 6) % 7));     // Montag dieser Woche
  if (day === 6 || day === 0) d.setDate(d.getDate() + 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
app.get('/api/public/week', async (req, res) => {
  try {
    const weekStart = publicWeekMonday();
    const [slots, deadlines] = await Promise.all([
      pool.query(`
        SELECT s.id, s.typ, to_char(s.datum,'YYYY-MM-DD') AS datum, s.uhrzeit, s.dauer, s.ort,
               sub.id AS "subjectId", sub.key AS "subjectKey", sub.name AS "subjectName",
               sub.color AS "subjectColor",
               (ts.id IS NOT NULL) AS booked, ts.thema, s.thema AS "slotThema"
        FROM talking_slots s
        LEFT JOIN subjects sub ON sub.id = s.subject_id
        LEFT JOIN talking_sessions ts ON ts.slot_id = s.id
        -- Lernberatung & Co. betreffen einzelne Personen und haben auf einer
        -- oeffentlichen Seite nichts verloren - auch nicht ohne Namen.
        WHERE s.klasse = $1 AND COALESCE(sub.nur_zugewiesen, false) = false
          AND s.datum >= $2::date
          AND s.datum <  $2::date + INTERVAL '7 days'
        ORDER BY s.datum, s.uhrzeit
      `, [PUBLIC_WEEK_KLASSE, weekStart]),
      pool.query(`
        SELECT id, to_char(datum,'YYYY-MM-DD') AS datum, titel
        FROM math_deadlines
        WHERE klasse = $1
          AND datum >= $2::date
          AND datum <  $2::date + INTERVAL '7 days'
        ORDER BY datum
      `, [PUBLIC_WEEK_KLASSE, weekStart]),
    ]);
    res.json({ klasse: PUBLIC_WEEK_KLASSE, slots: slots.rows, deadlines: deadlines.rows });
  } catch(e) { res.status(500).json({ error: 'Serverfehler' }); }
});

// ── Öffentliche Tagesseiten (/montag … /freitag) ──────────────────────────────
// Eigenständige, einbettbare Ansicht eines Wochentags der laufenden Woche - gedacht
// als Webseiten-Karte in Taskcards. Muss VOR dem Catch-all stehen, sonst würde dort
// index.html (die Login-Seite) ausgeliefert. Daten kommen clientseitig aus
// /api/public/week, also ohne Login und ohne Namen.
// Titel/Beschreibung werden hier serverseitig eingesetzt: Link-Vorschauen (Taskcards,
// Messenger, ...) rendern kein JavaScript, sonst zeigten alle fünf Tage denselben
// generischen Titel. tag.html wird dafür einmal gelesen und im Speicher gehalten.
const TAG_LABELS = {
  montag: 'Montag', dienstag: 'Dienstag', mittwoch: 'Mittwoch',
  donnerstag: 'Donnerstag', freitag: 'Freitag',
};
let tagHtmlCache = null;
const escAttr = (s) => String(s == null ? '' : s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

app.get(['/montag','/dienstag','/mittwoch','/donnerstag','/freitag'], (req, res) => {
  try {
    if (!tagHtmlCache) tagHtmlCache = fs.readFileSync(path.join(__dirname, 'public', 'tag.html'), 'utf8');
    const key = req.path.replace(/^\//, '').toLowerCase();
    const label = TAG_LABELS[key] || 'Tagesübersicht';
    const titel = `${label} · Tandem ${PUBLIC_WEEK_KLASSE}`;
    const beschreibung = `Talks und Fachbüro-Termine am ${label} der laufenden Woche – mit freien und schon gebuchten Terminen.`;
    // Host stammt aus dem Request-Header, deshalb wie alle Werte escaped.
    const url = `${req.protocol}://${req.get('host') || ''}${req.path}`;
    res.type('html').send(
      tagHtmlCache
        .split('__TITEL__').join(escAttr(titel))
        .split('__BESCHREIBUNG__').join(escAttr(beschreibung))
        .split('__URL__').join(escAttr(url))
    );
  } catch(e) {
    res.status(500).send('Tagesübersicht gerade nicht verfügbar.');
  }
});

// ── Catch-all ─────────────────────────────────────────────────────────────────
app.get('*', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

// ── Start ─────────────────────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => console.log(`✓ Lerntheke auf Port ${PORT}`));
}).catch(err => {
  console.error('DB Init fehlgeschlagen:', err);
  process.exit(1);
});
