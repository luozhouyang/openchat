import type { ReactNode } from "react";
import type { AnyFieldApi } from "@tanstack/react-form";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

function errorsOf(field: AnyFieldApi): string[] {
  return field.state.meta.errors.map((e) =>
    typeof e === "string" ? e : e instanceof Error ? e.message : String(e),
  );
}

export function FormField({
  field,
  label,
  children,
  className,
}: {
  field: AnyFieldApi;
  label: string;
  children: (field: AnyFieldApi) => ReactNode;
  className?: string;
}) {
  const errors = errorsOf(field);
  const showErrors =
    (field.state.meta.isTouched || field.state.meta.errorMap.onSubmit) && errors.length > 0;
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={field.name}>{label}</Label>
      {children(field)}
      {showErrors && (
        <p className="text-sm text-destructive" data-testid={`${field.name}-field-error`}>
          {errors[0]}
        </p>
      )}
    </div>
  );
}
