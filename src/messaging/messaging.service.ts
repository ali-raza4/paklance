import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SendMessageDto } from './dto/send-message.dto';
import { PushService } from '../push/push.service';

@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pushService: PushService,
  ) {}

  async findOrCreateConversation(userId: string, otherUserId: string) {
    if (userId === otherUserId) {
      throw new BadRequestException('Cannot start a conversation with yourself');
    }

    const otherUser = await this.prisma.user.findUnique({
      where: { id: otherUserId },
    });
    if (!otherUser) {
      throw new NotFoundException('Receiver user not found');
    }

    let conversation = await this.prisma.conversation.findFirst({
      where: {
        OR: [
          { participant1Id: userId, participant2Id: otherUserId },
          { participant1Id: otherUserId, participant2Id: userId },
        ],
      },
    });
    if (!conversation) {
      conversation = await this.prisma.conversation.create({
        data: { participant1Id: userId, participant2Id: otherUserId },
      });
    }
    return conversation;
  }

  async sendMessage(senderId: string, dto: SendMessageDto) {
    if (!dto.content || !dto.content.trim()) {
      throw new BadRequestException('Message content cannot be empty');
    }

    const conversation = await this.findOrCreateConversation(
      senderId,
      dto.receiverId,
    );

    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId,
        content: dto.content.trim(),
      },
    });

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    // Send Web Push notification to the receiver (never to the sender).
    // Fetch sender name for notification title.
    try {
      const sender = await this.prisma.user.findUnique({
        where: { id: senderId },
        select: { name: true, email: true },
      });
      const senderName =
        sender?.name || sender?.email?.split('@')[0] || 'Someone';
      const preview =
        dto.content.trim().length > 60
          ? dto.content.trim().slice(0, 57) + '\u2026'
          : dto.content.trim();

      await this.pushService.sendPushToUser(dto.receiverId, {
        title: `Paklance — ${senderName}`,
        body: preview,
        tag: `msg_${message.id}`,
        data: {
          url: '/#messages',
          senderId,
          senderName,
          messageId: message.id,
        },
      });
    } catch {
      // Push failure must never break the message send flow
    }

    return message;
  }

  async getMyConversations(userId: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        OR: [{ participant1Id: userId }, { participant2Id: userId }],
      },
      include: {
        Message: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const otherUserIds = Array.from(
      new Set(
        conversations.map((c) =>
          c.participant1Id === userId ? c.participant2Id : c.participant1Id,
        ),
      ),
    );

    const users = await this.prisma.user.findMany({
      where: { id: { in: otherUserIds } },
      select: {
        id: true,
        name: true,
        email: true,
        avatarUrl: true,
        role: true,
        headline: true,
      },
    });

    const userMap = new Map(users.map((u) => [u.id, u]));

    // Mark incoming messages as delivered when recipient is online and syncs conversations
    const userConvIds = conversations.map((c) => c.id);
    if (userConvIds.length > 0) {
      await this.prisma.message.updateMany({
        where: {
          conversationId: { in: userConvIds },
          senderId: { not: userId },
          isDelivered: false,
        },
        data: {
          isDelivered: true,
        },
      });
    }

    return conversations.map((c) => {
      const otherUserId =
        c.participant1Id === userId ? c.participant2Id : c.participant1Id;
      const otherUser = userMap.get(otherUserId) || {
        id: otherUserId,
        name: 'User',
        email: '',
        role: 'CLIENT',
        headline: null,
      };
      const lastMessage = c.Message[0] || null;
      return {
        id: c.id,
        participant1Id: c.participant1Id,
        participant2Id: c.participant2Id,
        otherUser,
        lastMessage,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      };
    });
  }

  async syncDelivered(userId: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        OR: [{ participant1Id: userId }, { participant2Id: userId }],
      },
      select: { id: true },
    });
    const convIds = conversations.map((c) => c.id);
    if (convIds.length === 0) return { success: true, updatedCount: 0 };

    const res = await this.prisma.message.updateMany({
      where: {
        conversationId: { in: convIds },
        senderId: { not: userId },
        isDelivered: false,
      },
      data: {
        isDelivered: true,
      },
    });
    return { success: true, updatedCount: res.count };
  }

  async getConversationMessages(userId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    const isParticipant =
      conversation.participant1Id === userId ||
      conversation.participant2Id === userId;
    if (!isParticipant) throw new ForbiddenException('Not your conversation');

    // Mark unread messages sent by the other user as Delivered & Read (Seen)
    await this.prisma.message.updateMany({
      where: {
        conversationId,
        senderId: { not: userId },
        OR: [{ isRead: false }, { isDelivered: false }],
      },
      data: {
        isDelivered: true,
        isRead: true,
      },
    });

    return this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async deleteMessage(userId: string, messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });
    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (message.senderId !== userId) {
      throw new ForbiddenException('You can only unsend your own messages');
    }

    await this.prisma.message.delete({
      where: { id: messageId },
    });

    return { success: true, id: messageId };
  }

  async searchUsers(currentUserId: string, query?: string) {
    const q = (query || '').trim();
    const where: any = {
      isDeleted: false,
      id: { not: currentUserId },
    };

    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { headline: { contains: q, mode: 'insensitive' } },
      ];
    }

    const users = await this.prisma.user.findMany({
      where,
      take: 20,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        headline: true,
        avatarUrl: true,
      },
    });

    return users.map((u) => {
      const name = u.name || (u.email ? u.email.split('@')[0] : 'User');
      return {
        id: u.id,
        name,
        email: u.email,
        role: u.role === 'CLIENT' ? 'Client' : 'Specialist / Freelancer',
        rawRole: u.role,
        headline: u.headline || (u.role === 'CLIENT' ? 'Client' : 'Specialist / Freelancer'),
        avatarUrl: u.avatarUrl || null,
        accountType: u.role === 'CLIENT' ? 'Client' : 'Specialist/Freelancer',
      };
    });
  }
}


