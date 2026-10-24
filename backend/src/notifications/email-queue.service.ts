export interface InviteEmailPayload {
  to: string;
  orgName: string;
  inviterName: string;
  acceptUrl: string;
}

/**
 * Abstract so InvitationsService never talks to BullMQ directly. Tests
 * override this token with a stub instead of needing a real Redis
 * connection — see notifications.module.ts and the invitations spec.
 */
export abstract class EmailQueueService {
  abstract enqueueInviteEmail(payload: InviteEmailPayload): Promise<void>;
}
