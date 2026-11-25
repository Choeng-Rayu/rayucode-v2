import * as React from "react"
import { Check, ChevronDown, Folder, FolderPlus, Laptop, X } from "lucide-react"
import { toast } from "sonner"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ipcClient, type SidebarProjectMeta } from "@/lib/ipc-client"

import { ProjectIconPicker, type ProjectIconSpec } from "./project-icon-picker"

export interface CreateProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (project: SidebarProjectMeta) => void
}

const DEFAULT_ICON: ProjectIconSpec = {
  iconKind: "icon",
  iconValue: "folder",
  iconColor: "folder",
}

function displayFolderName(folderPath: string): string {
  const parts = folderPath.replace(/\/+$/, "").split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? folderPath
}

function CreateProjectDialogBody({
  onOpenChange,
  onCreate,
}: Omit<CreateProjectDialogProps, "open">) {
  const [name, setName] = React.useState("")
  const [folders, setFolders] = React.useState<string[]>([])
  const [icon, setIcon] = React.useState<ProjectIconSpec>(DEFAULT_ICON)
  const [submitting, setSubmitting] = React.useState(false)

  const handleAddFolder = async () => {
    const picked = await ipcClient.workspace.pickFolder()
    if (!picked?.path) return
    setFolders((prev) =>
      prev.includes(picked.path) ? prev : [...prev, picked.path]
    )
    setName((prev) => (prev.trim() ? prev : picked.project))
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submitting) return
    const cleanName = name.trim() || (folders[0] ? displayFolderName(folders[0]) : "")
    if (!cleanName) {
      toast.error("Give your project a name")
      return
    }
    if (folders.length === 0) {
      toast.error("Add at least one source folder")
      return
    }
    setSubmitting(true)
    try {
      const primary = folders[0]
      const registered = await ipcClient.workspace.ensure(primary, cleanName)
      const canonicalPrimary = registered.canonicalPath || registered.path
      const dedupedFolders = [
        canonicalPrimary,
        ...folders.slice(1).filter((f) => f !== canonicalPrimary),
      ]
      onCreate({
        id: registered.id,
        name: cleanName,
        folders: dedupedFolders,
        iconKind: icon.iconKind,
        iconValue: icon.iconValue,
        iconColor: icon.iconColor,
        pinned: false,
        sectionId: null,
        updatedAt: Date.now(),
      })
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-1 flex flex-col gap-4">
      {/* Icon picker + project name */}
      <div className="flex items-center overflow-hidden rounded-xl border border-hairline bg-inset focus-within:border-info focus-within:ring-2 focus-within:ring-info-soft">
        <ProjectIconPicker value={icon} onChange={setIcon} />
        <input
          type="text"
          autoFocus
          aria-label="Project name"
          data-testid="create-project-name-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Project name"
          className="h-10 min-w-0 flex-1 bg-transparent px-3 text-sm text-ink outline-none placeholder:text-muted-ink"
        />
      </div>

      {/* Source folders */}
      <div className="flex flex-col gap-1.5">
        <div className="text-[13px] font-medium text-ink">Source folders</div>
        <div className="overflow-hidden rounded-xl border border-hairline">
          {folders.length > 0 ? (
            <div className="divide-y divide-hairline-soft border-b border-hairline-soft">
              {folders.map((folderPath) => (
                <div
                  key={folderPath}
                  data-testid="create-project-folder-row"
                  className="flex items-center justify-between gap-2 px-3 py-2.5 text-[13px] text-ink"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Folder
                      className="size-4 shrink-0 text-muted-ink"
                      strokeWidth={1.65}
                      aria-hidden="true"
                    />
                    <span className="truncate" title={folderPath}>
                      {displayFolderName(folderPath)}
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove folder ${displayFolderName(folderPath)}`}
                    onClick={() =>
                      setFolders((prev) => prev.filter((f) => f !== folderPath))
                    }
                    className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-muted-ink transition-colors hover:bg-hover hover:text-ink"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex flex-col items-center gap-2.5 px-4 py-6">
            <div className="flex items-center gap-1 text-[13px] text-muted-ink">
              <span>Add a folder on</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Folder location"
                    className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1 font-medium text-ink transition-colors hover:bg-hover"
                  >
                    this computer
                    <ChevronDown className="size-3.5" aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" className="w-[180px] rounded-xl">
                  <DropdownMenuItem>
                    <Laptop className="size-3.5" aria-hidden="true" />
                    <span>This computer</span>
                    <Check className="ml-auto size-3.5" aria-hidden="true" />
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <button
              type="button"
              data-testid="create-project-add-folder-btn"
              onClick={() => void handleAddFolder()}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-active px-3 py-1.5 text-[13px] font-medium text-ink transition-colors hover:bg-hover"
            >
              <FolderPlus className="size-4" strokeWidth={1.65} aria-hidden="true" />
              <span>Add</span>
            </button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="cursor-pointer rounded-xl px-3.5 py-2 text-[13px] font-medium text-muted-ink transition-colors hover:bg-hover hover:text-ink"
        >
          Cancel
        </button>
        <button
          type="submit"
          data-testid="create-project-submit-btn"
          className="cursor-pointer rounded-xl bg-ink px-4 py-2 text-[13px] font-medium text-canvas transition-opacity hover:opacity-90"
        >
          Create project
        </button>
      </div>
    </form>
  )
}

export function CreateProjectDialog({
  open,
  onOpenChange,
  onCreate,
}: CreateProjectDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="create-project-dialog"
        className="w-[520px] max-w-[calc(100vw-2rem)] rounded-2xl border-premium-hi bg-popover p-5 text-ink shadow-rayu-2"
      >
        <DialogHeader className="gap-0">
          <DialogTitle className="text-[19px] font-semibold tracking-tight text-ink">
            Create project
          </DialogTitle>
          <DialogDescription className="sr-only">
            Name your project, pick an icon, and add one or more source folders.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <CreateProjectDialogBody
            onOpenChange={onOpenChange}
            onCreate={onCreate}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
