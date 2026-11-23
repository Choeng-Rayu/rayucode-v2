import * as React from "react"
import { Folder, FolderPlus, X } from "lucide-react"
import { toast } from "sonner"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ipcClient, type SidebarProjectMeta } from "@/lib/ipc-client"

import { ProjectIconPicker, type ProjectIconSpec } from "./project-icon-picker"

export interface EditProjectDialogProps {
  project: SidebarProjectMeta | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (updated: SidebarProjectMeta) => void
  onRemove: (projectId: string) => void
}

function displayFolderName(folderPath: string): string {
  const parts = folderPath.replace(/\/+$/, "").split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? folderPath
}

function EditProjectDialogBody({
  project,
  onOpenChange,
  onSave,
  onRemove,
}: {
  project: SidebarProjectMeta
  onOpenChange: (open: boolean) => void
  onSave: (updated: SidebarProjectMeta) => void
  onRemove: (projectId: string) => void
}) {
  const [draftName, setDraftName] = React.useState(project.name)
  const [draftFolders, setDraftFolders] = React.useState<string[]>(
    project.folders
  )
  const [draftIcon, setDraftIcon] = React.useState<ProjectIconSpec>({
    iconKind: project.iconKind,
    iconValue: project.iconValue,
    iconColor: project.iconColor,
  })

  const handleAddFolder = async () => {
    const picked = await ipcClient.workspace.pickFolder()
    if (!picked?.path) return
    setDraftFolders((prev) =>
      prev.includes(picked.path) ? prev : [...prev, picked.path]
    )
    toast(`Added folder ${picked.project}`)
  }

  const handleRemoveFolder = (folderPath: string) => {
    setDraftFolders((prev) => prev.filter((item) => item !== folderPath))
  }

  const handleSave = (event: React.FormEvent) => {
    event.preventDefault()
    const cleanName = draftName.trim()
    if (!cleanName) {
      toast.error("Project name cannot be empty")
      return
    }
    onSave({
      ...project,
      name: cleanName,
      folders: draftFolders.length > 0 ? draftFolders : project.folders,
      iconKind: draftIcon.iconKind,
      iconValue: draftIcon.iconValue,
      iconColor: draftIcon.iconColor,
      updatedAt: Date.now(),
    })
    onOpenChange(false)
  }

  return (
    <form onSubmit={handleSave} className="mt-1 flex flex-col gap-4">
      {/* Unified Icon/Emoji Picker + Name Input */}
      <div className="flex items-center overflow-hidden rounded-xl border border-hairline-hi bg-inset focus-within:border-info focus-within:ring-2 focus-within:ring-info-soft">
        <ProjectIconPicker value={draftIcon} onChange={setDraftIcon} />
        <input
          type="text"
          aria-label="Project name"
          data-testid="edit-project-name-input"
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          placeholder="Project name"
          className="h-10 min-w-0 flex-1 bg-transparent px-3 text-sm text-ink outline-none placeholder:text-muted-ink"
        />
      </div>

      {/* Source folders */}
      <div className="flex flex-col gap-1.5">
        <div className="text-xs font-medium text-muted-ink">Source folders</div>
        <div className="divide-y divide-hairline-soft overflow-hidden rounded-xl border border-hairline bg-pane/70">
          {draftFolders.map((folderPath) => (
            <div
              key={folderPath}
              data-testid="edit-project-folder-row"
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
                onClick={() => handleRemoveFolder(folderPath)}
                className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-muted-ink transition-colors hover:bg-hover hover:text-ink"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          ))}

          <button
            type="button"
            data-testid="edit-project-add-folder-btn"
            onClick={() => void handleAddFolder()}
            className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left text-[13px] text-body transition-colors hover:bg-hover hover:text-ink"
          >
            <FolderPlus
              className="size-4 shrink-0 text-muted-ink"
              strokeWidth={1.65}
              aria-hidden="true"
            />
            <span>Add folder</span>
          </button>
        </div>
      </div>

      {/* Footer actions */}
      <div className="mt-1 flex items-center justify-between gap-2">
        <button
          type="button"
          data-testid="edit-project-remove-btn"
          onClick={() => {
            onRemove(project.id)
            onOpenChange(false)
          }}
          className="cursor-pointer rounded-xl bg-danger-soft px-3.5 py-2 text-[13px] font-medium text-danger transition-colors hover:brightness-110"
        >
          Remove local project
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="cursor-pointer rounded-xl px-3.5 py-2 text-[13px] font-medium text-muted-ink transition-colors hover:bg-hover hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="submit"
            data-testid="edit-project-save-btn"
            className="cursor-pointer rounded-xl bg-ink px-4 py-2 text-[13px] font-medium text-canvas transition-opacity hover:opacity-90"
          >
            Save
          </button>
        </div>
      </div>
    </form>
  )
}

export function EditProjectDialog({
  project,
  open,
  onOpenChange,
  onSave,
  onRemove,
}: EditProjectDialogProps) {
  if (!project) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="edit-project-dialog"
        className="w-[460px] max-w-[calc(100vw-2rem)] rounded-2xl border-premium-hi bg-popover p-5 text-ink shadow-rayu-2"
      >
        <DialogHeader className="gap-0">
          <DialogTitle className="text-[17px] font-semibold tracking-tight text-ink">
            Edit project
          </DialogTitle>
          <DialogDescription className="sr-only">
            Customize project name, icon or emoji, and source folders.
          </DialogDescription>
        </DialogHeader>

        <EditProjectDialogBody
          key={`${project.id}-${project.updatedAt}`}
          project={project}
          onOpenChange={onOpenChange}
          onSave={onSave}
          onRemove={onRemove}
        />
      </DialogContent>
    </Dialog>
  )
}
