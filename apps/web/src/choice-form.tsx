"use client";

export function ChoiceForm({
  label,
  name,
  value,
  options,
  hidden,
}: {
  label: string;
  name: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  hidden: Array<{ name: string; value: string }>;
}) {
  return (
    <form autoComplete="off" method="get" action="/">
      {hidden.map((field) => (
        <input
          key={field.name}
          type="hidden"
          name={field.name}
          value={field.value}
        />
      ))}
      <label htmlFor={name}>{label}</label>
      <select
        // Remounted when the chosen value changes from outside (a demo reset moves the
        // page to the new engagement without a full load), so the shown choice never
        // stays on the old one (29 October 2026).
        key={value}
        id={name}
        name={name}
        defaultValue={value}
        onChange={(event) => {
          event.currentTarget.form?.requestSubmit();
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </form>
  );
}
