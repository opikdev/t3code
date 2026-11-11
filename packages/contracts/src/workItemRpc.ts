import * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";

import { EnvironmentAuthorizationError } from "./auth.ts";
import {
  WorkItemCommentInput,
  WorkItemCreateInput,
  WorkItemError,
  WorkItemListDeletedInput,
  WorkItemListDeletedResult,
  WorkItemMoveInput,
  WorkItemMutationResult,
  WorkItemReadInput,
  WorkItemReadResult,
  WorkItemSetDeletedInput,
  WorkItemSetLinkInput,
  WorkItemSetLinkResult,
  WorkItemSpaceCreateInput,
  WorkItemSpaceEvent,
  WorkItemSpaceListInput,
  WorkItemSpaceListResult,
  WorkItemSpaceMutationResult,
  WorkItemSpaceSetArchivedInput,
  WorkItemSpaceSubscribeInput,
  WorkItemSpaceUpdateInput,
  WorkItemUpdateInput,
} from "./workItem.ts";

export const WORK_ITEM_WS_METHODS = {
  subscribeSpaces: "workItems.subscribeSpaces",
  subscribeSpace: "workItems.subscribeSpace",
  read: "workItems.read",
  listDeleted: "workItems.listDeleted",
  createSpace: "workItems.createSpace",
  updateSpace: "workItems.updateSpace",
  setSpaceArchived: "workItems.setSpaceArchived",
  create: "workItems.create",
  update: "workItems.update",
  move: "workItems.move",
  setLink: "workItems.setLink",
  comment: "workItems.comment",
  setDeleted: "workItems.setDeleted",
} as const;

const error = Schema.Union([WorkItemError, EnvironmentAuthorizationError]);

export const WORK_ITEM_RPCS = [
  Rpc.make(WORK_ITEM_WS_METHODS.subscribeSpaces, {
    payload: WorkItemSpaceListInput,
    success: WorkItemSpaceListResult,
    error,
    stream: true,
  }),
  Rpc.make(WORK_ITEM_WS_METHODS.subscribeSpace, {
    payload: WorkItemSpaceSubscribeInput,
    success: WorkItemSpaceEvent,
    error,
    stream: true,
  }),
  Rpc.make(WORK_ITEM_WS_METHODS.read, {
    payload: WorkItemReadInput,
    success: WorkItemReadResult,
    error,
  }),
  Rpc.make(WORK_ITEM_WS_METHODS.listDeleted, {
    payload: WorkItemListDeletedInput,
    success: WorkItemListDeletedResult,
    error,
  }),
  Rpc.make(WORK_ITEM_WS_METHODS.createSpace, {
    payload: WorkItemSpaceCreateInput,
    success: WorkItemSpaceMutationResult,
    error,
  }),
  Rpc.make(WORK_ITEM_WS_METHODS.updateSpace, {
    payload: WorkItemSpaceUpdateInput,
    success: WorkItemSpaceMutationResult,
    error,
  }),
  Rpc.make(WORK_ITEM_WS_METHODS.setSpaceArchived, {
    payload: WorkItemSpaceSetArchivedInput,
    success: WorkItemSpaceMutationResult,
    error,
  }),
  Rpc.make(WORK_ITEM_WS_METHODS.create, {
    payload: WorkItemCreateInput,
    success: WorkItemMutationResult,
    error,
  }),
  Rpc.make(WORK_ITEM_WS_METHODS.update, {
    payload: WorkItemUpdateInput,
    success: WorkItemMutationResult,
    error,
  }),
  Rpc.make(WORK_ITEM_WS_METHODS.move, {
    payload: WorkItemMoveInput,
    success: WorkItemMutationResult,
    error,
  }),
  Rpc.make(WORK_ITEM_WS_METHODS.setLink, {
    payload: WorkItemSetLinkInput,
    success: WorkItemSetLinkResult,
    error,
  }),
  Rpc.make(WORK_ITEM_WS_METHODS.comment, {
    payload: WorkItemCommentInput,
    success: WorkItemReadResult,
    error,
  }),
  Rpc.make(WORK_ITEM_WS_METHODS.setDeleted, {
    payload: WorkItemSetDeletedInput,
    success: WorkItemMutationResult,
    error,
  }),
] as const;
