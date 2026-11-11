# Work items

Plan and track work with your agents. Open **Work items** from the sidebar or the command palette,
or press `mod+shift+u` on web and desktop when the terminal is not focused. Customize
`workItems.open` in **Settings → Keybindings**.

## Spaces

A space holds the work items for one or more repos on one environment. Choose **New space**, give
it a name and a key such as `SHOP`, and pick its repos. Items are numbered from the key
(`SHOP-12`), and the key cannot change later. A repo can belong to more than one space.

A repo with open items stays in its space until you close or move those items. Archive a space
from its settings to make it read-only, and restore it the same way.

## Items

Each item has a type, a status, and a priority.

| Type    | Use it for                                   |
| ------- | -------------------------------------------- |
| Epic    | A larger goal that holds other items         |
| Feature | New behavior a user can see                  |
| Task    | A concrete piece of technical work           |
| Bug     | Something broken                             |
| Chore   | Refactors, dependencies, cleanup             |
| Spike   | A question to research, with no code changes |

Every item except an epic works in one of its space's repos. Items can have a parent, and can block,
relate to, or duplicate other items in the space. An item is marked **Blocked** while anything
blocking it is still open. Put acceptance criteria in the description as a checklist.

Switch between **Board**, **List**, and **Table**. Drag cards on the board to change status or
order. Deleted items stay under **Deleted** until you restore them.

## Working with agents

Choose **Start agent** on an item to open a new thread in its repo with a prompt to pick it up.
Agents in any thread can also list, read, create, and update work items, and add relations and
comments. Ask one to "take the next ready item" and it picks the most urgent unblocked item in
**Todo**. When an agent moves an item to **In Progress** or **In Review**, its thread is linked to
the item, and every change it makes shows in the item's activity.
