import { Test, TestingModule } from '@nestjs/testing';
import { MessagingService } from './messaging.service';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

const mockPrismaService = {
  conversation: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  message: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  },
};

const mockPushService = {
  sendPushToUser: jest.fn(),
};

describe('MessagingService', () => {
  let service: MessagingService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagingService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: PushService, useValue: mockPushService },
      ],
    }).compile();

    service = module.get<MessagingService>(MessagingService);
  });

  describe('getConversationMessages', () => {
    it('marks unread incoming messages as read & delivered and returns messages', async () => {
      mockPrismaService.conversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        participant1Id: 'user-1',
        participant2Id: 'user-2',
      });
      mockPrismaService.message.updateMany.mockResolvedValue({ count: 2 });
      mockPrismaService.message.findMany.mockResolvedValue([
        { id: 'msg-1', content: 'Hello', senderId: 'user-2', isRead: true, isDelivered: true },
        { id: 'msg-2', content: 'Hi there', senderId: 'user-1', isRead: false, isDelivered: false },
      ]);

      const result = await service.getConversationMessages('user-1', 'conv-1');

      expect(mockPrismaService.conversation.findUnique).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
      });
      expect(mockPrismaService.message.updateMany).toHaveBeenCalledWith({
        where: {
          conversationId: 'conv-1',
          senderId: { not: 'user-1' },
          OR: [{ isRead: false }, { isDelivered: false }],
        },
        data: { isDelivered: true, isRead: true },
      });
      expect(result).toHaveLength(2);
    });

    it('throws ForbiddenException if user is not in conversation', async () => {
      mockPrismaService.conversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        participant1Id: 'user-2',
        participant2Id: 'user-3',
      });

      await expect(
        service.getConversationMessages('user-1', 'conv-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('syncDelivered', () => {
    it('marks incoming messages in user conversations as delivered', async () => {
      mockPrismaService.conversation.findMany.mockResolvedValue([
        { id: 'conv-1' },
        { id: 'conv-2' },
      ]);
      mockPrismaService.message.updateMany.mockResolvedValue({ count: 3 });

      const res = await service.syncDelivered('user-1');

      expect(mockPrismaService.message.updateMany).toHaveBeenCalledWith({
        where: {
          conversationId: { in: ['conv-1', 'conv-2'] },
          senderId: { not: 'user-1' },
          isDelivered: false,
        },
        data: { isDelivered: true },
      });
      expect(res).toEqual({ success: true, updatedCount: 3 });
    });
  });

  describe('deleteMessage (Unsend)', () => {
    it('successfully deletes own message', async () => {
      mockPrismaService.message.findUnique.mockResolvedValue({
        id: 'msg-1',
        senderId: 'user-1',
        content: 'To be unsent',
      });
      mockPrismaService.message.delete.mockResolvedValue({ id: 'msg-1' });

      const result = await service.deleteMessage('user-1', 'msg-1');

      expect(mockPrismaService.message.delete).toHaveBeenCalledWith({
        where: { id: 'msg-1' },
      });
      expect(result).toEqual({ success: true, id: 'msg-1' });
    });

    it('throws ForbiddenException if user tries to unsend someone else message', async () => {
      mockPrismaService.message.findUnique.mockResolvedValue({
        id: 'msg-1',
        senderId: 'user-2',
        content: 'Not your message',
      });

      await expect(service.deleteMessage('user-1', 'msg-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws NotFoundException if message does not exist', async () => {
      mockPrismaService.message.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteMessage('user-1', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('searchUsers', () => {
    it('searches eligible users by partial name/email and excludes self', async () => {
      mockPrismaService.user.findMany.mockResolvedValue([
        {
          id: 'user-2',
          name: 'Usman Ali',
          email: 'usman@test.com',
          role: 'SPECIALIST',
          headline: 'Mobile App Developer',
          avatarUrl: 'https://example.com/avatar.jpg',
        },
      ]);

      const result = await service.searchUsers('user-1', 'Usman');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'user-2',
        name: 'Usman Ali',
        email: 'usman@test.com',
        role: 'Specialist / Freelancer',
        rawRole: 'SPECIALIST',
        headline: 'Mobile App Developer',
        avatarUrl: 'https://example.com/avatar.jpg',
        accountType: 'Specialist/Freelancer',
      });
      expect(mockPrismaService.user.findMany).toHaveBeenCalledWith({
        where: {
          isDeleted: false,
          id: { not: 'user-1' },
          OR: [
            { name: { contains: 'Usman', mode: 'insensitive' } },
            { email: { contains: 'Usman', mode: 'insensitive' } },
            { headline: { contains: 'Usman', mode: 'insensitive' } },
          ],
        },
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
    });
  });
});

