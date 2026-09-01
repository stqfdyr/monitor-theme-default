import * as React from "react"

import { cn } from "@/lib/utils"

// Only the shell. shadcn's card ships a header, title, description, action,
// content and footer alongside it; this theme lays its cards out itself, so
// all six were dead the moment they were vendored in. Add one back from
// upstream if a card ever wants it.
function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "flex flex-col gap-6 rounded-xl border bg-card py-6 text-card-foreground shadow-sm",
        className
      )}
      {...props}
    />
  )
}

export { Card }
