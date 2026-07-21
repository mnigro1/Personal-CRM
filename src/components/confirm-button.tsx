"use client";

import { Button } from "@/components/ui/button";

/** Submit button that asks for confirmation before letting the form submit. */
export function ConfirmButton({
  message,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { message: string }) {
  return (
    <Button
      {...props}
      type="submit"
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </Button>
  );
}
