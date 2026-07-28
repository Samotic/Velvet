'use client';

import { RippleButton, useRipple } from '@/components/ui/Ripple';
import type { Gender } from '@/lib/authTypes';
import { GENDERS, MIN_AGE } from '@/lib/onboarding';

/**
 * Step 3 — age and gender.
 *
 * Gender is three toggle cards rather than a select: it's a short, fixed set,
 * and the cards carry the copper active state the rest of the flow uses.
 */
export function StepAbout({
  age,
  gender,
  onAge,
  onGender,
  onContinue,
}: {
  age: string;
  gender: Gender | null;
  onAge: (v: string) => void;
  onGender: (v: Gender) => void;
  onContinue: () => void;
}) {
  const ripple = useRipple();

  const ageNum = Number(age);
  const ageOk = age !== '' && Number.isFinite(ageNum) && ageNum >= MIN_AGE && ageNum <= 120;
  const canContinue = ageOk && gender !== null;

  const tooYoung = age !== '' && Number.isFinite(ageNum) && ageNum < MIN_AGE;

  return (
    <div>
      <h1 className="onb-title">
        Tell us <em>about you</em>
      </h1>
      <p className="onb-sub">This shapes what the advisor recommends. Nothing is public.</p>

      <div className="onb-form">
        <div className="field">
          <label className="field-label" htmlFor="onb-age">
            Age
          </label>
          <input
            id="onb-age"
            className="input"
            type="number"
            inputMode="numeric"
            min={MIN_AGE}
            max={120}
            value={age}
            onChange={(e) => onAge(e.target.value)}
            placeholder={String(MIN_AGE)}
          />
          <div className={`field-hint ${tooYoung ? 'error' : 'muted'}`}>
            {tooYoung ? `You need to be at least ${MIN_AGE} to use Velvet` : ''}
          </div>
        </div>

        <div className="field">
          <span className="field-label">Gender</span>
          <div className="select-grid cols-3" role="radiogroup" aria-label="Gender">
            {GENDERS.map((g) => (
              <button
                key={g.id}
                type="button"
                role="radio"
                aria-checked={gender === g.id}
                className={`select-card ripple-host${gender === g.id ? ' on' : ''}`}
                onClick={(e) => {
                  ripple(e);
                  onGender(g.id);
                }}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="onb-actions">
        <RippleButton
          className="btn-fill btn-lg btn-block"
          disabled={!canContinue}
          onClick={onContinue}
        >
          Continue
        </RippleButton>
      </div>
    </div>
  );
}
