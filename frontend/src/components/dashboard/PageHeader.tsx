import { cn } from "@/lib/utils";

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  actionClassName?: string;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  actionClassName,
}: PageHeaderProps) {
  return (
    <header className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
            {eyebrow}
          </p>
        )}
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground mt-2 max-w-xl">
            {description}
          </p>
        )}
      </div>
      {action && (
        <div className={cn("flex items-center gap-3", actionClassName)}>
          {action}
        </div>
      )}
    </header>
  );
}
