import { Skeleton } from "@/components/ui/skeleton";

export function ChatSkeleton() {
  return (
    <div
      data-slot="chat-skeleton"
      className="mx-auto flex w-full max-w-[780px] flex-1 flex-col gap-5 px-4 py-5"
    >
      <Skeleton className="h-4 w-48" />
      <div className="self-end">
        <Skeleton className="h-14 w-64 rounded-2xl" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-6 w-36 rounded-full" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    </div>
  );
}

export function ContextSkeleton() {
  return (
    <div data-slot="context-skeleton" className="flex flex-col gap-4 p-4">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-16 w-full rounded-lg" />
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-3 w-full rounded-full" />
      <Skeleton className="h-28 w-full rounded-lg" />
    </div>
  );
}

export function SwarmSkeleton() {
  return (
    <div
      data-slot="swarm-skeleton"
      className="mx-auto flex w-full max-w-[1120px] flex-col gap-4 p-5 @container"
    >
      <Skeleton className="h-10 w-full rounded-lg" />
      <div className="grid grid-cols-1 gap-4 @min-[780px]:grid-cols-[320px_1fr]">
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
      <Skeleton className="h-36 w-full rounded-xl" />
    </div>
  );
}

export function AutomationsSkeleton() {
  return (
    <div
      data-slot="automations-skeleton"
      className="mx-auto flex w-full max-w-[980px] flex-col gap-5 p-5"
    >
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-28 w-full rounded-xl" />
      <Skeleton className="h-36 w-full rounded-xl" />
    </div>
  );
}

export function PluginsSkeleton() {
  return (
    <div
      data-slot="plugins-skeleton"
      className="mx-auto flex w-full max-w-[1040px] flex-col gap-5 p-5 @container"
    >
      <Skeleton className="h-10 w-56" />
      <Skeleton className="h-40 w-full rounded-2xl" />
      <div className="grid grid-cols-1 gap-3 @min-[600px]:grid-cols-2">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    </div>
  );
}

export function ChangesSkeleton() {
  return (
    <div
      data-slot="changes-skeleton"
      className="mx-auto flex w-full max-w-[980px] flex-col gap-4 p-5"
    >
      <Skeleton className="h-8 w-52" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

export function RemoteSkeleton() {
  return (
    <div
      data-slot="remote-skeleton"
      className="mx-auto flex w-full max-w-[980px] flex-col gap-5 p-5"
    >
      <Skeleton className="h-10 w-60" />
      <Skeleton className="h-44 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
    </div>
  );
}

export function SettingsSkeleton() {
  return (
    <div
      data-slot="settings-skeleton"
      className="mx-auto flex w-full max-w-[760px] flex-col gap-4 p-6"
    >
      <Skeleton className="h-8 w-44" />
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-16 w-full rounded-lg" />
      <Skeleton className="h-16 w-full rounded-lg" />
    </div>
  );
}
