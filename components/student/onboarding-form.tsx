"use client";

import { useState } from "react";
import { Check, ChevronLeft, GraduationCap, Layers } from "lucide-react";

import { FnButton } from "@/components/fahimni";

export type GradeOption = {
  id: string;
  name: string;
  fields: { id: string; name: string }[];
};

export function OnboardingForm({ grades }: { grades: GradeOption[] }) {
  const [gradeId, setGradeId] = useState<string | null>(null);
  const [fieldId, setFieldId] = useState<string | null>(null);

  const selectedGrade = grades.find((grade) => grade.id === gradeId) ?? null;
  const fields = selectedGrade?.fields ?? [];
  const ready = Boolean(selectedGrade) && (fields.length === 0 || Boolean(fieldId));

  return (
    <form action="/api/onboarding" method="post" className="fn-stack fn-stack--lg">
      <fieldset className="fn-fieldset">
        <legend className="fn-legend">صفك الدراسي</legend>
        {grades.map((grade) => (
          <label key={grade.id} className="fn-choice">
            <input
              type="radio"
              name="gradeId"
              value={grade.id}
              checked={gradeId === grade.id}
              onChange={() => {
                setGradeId(grade.id);
                setFieldId(null);
              }}
              required
            />
            <span className="fn-icon-tile">
              <GraduationCap size={22} aria-hidden="true" />
            </span>
            <span className="fn-choice__body">
              <span className="fn-choice__title">{grade.name}</span>
            </span>
            <Check className="fn-choice__check" size={20} aria-hidden="true" />
          </label>
        ))}
      </fieldset>

      {selectedGrade && fields.length > 0 ? (
        <fieldset className="fn-fieldset">
          <legend className="fn-legend">حقلك الدراسي</legend>
          {fields.map((field) => (
            <label key={field.id} className="fn-choice">
              <input
                type="radio"
                name="academicFieldId"
                value={field.id}
                checked={fieldId === field.id}
                onChange={() => setFieldId(field.id)}
                required
              />
              <span className="fn-icon-tile fn-icon-tile--sky">
                <Layers size={22} aria-hidden="true" />
              </span>
              <span className="fn-choice__body">
                <span className="fn-choice__title">{field.name}</span>
              </span>
              <Check className="fn-choice__check" size={20} aria-hidden="true" />
            </label>
          ))}
        </fieldset>
      ) : null}

      <FnButton type="submit" size="lg" block disabled={!ready}>
        التالي
        <ChevronLeft size={19} aria-hidden="true" />
      </FnButton>
    </form>
  );
}
