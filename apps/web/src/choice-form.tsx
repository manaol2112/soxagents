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
    <form method="get" action="/">
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
