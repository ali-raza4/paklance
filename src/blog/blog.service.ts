import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBlogDto } from './dto/create-blog.dto';
import { UpdateBlogDto } from './dto/update-blog.dto';
import { BlogStatus } from '@prisma/client';

@Injectable()
export class BlogService {
  private readonly logger = new Logger(BlogService.name);

  constructor(private readonly prisma: PrismaService) {}

  public generateSlug(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private async ensureUniqueSlug(baseSlug: string, currentId?: string): Promise<string> {
    let slug = baseSlug || 'untitled-post';
    let counter = 1;

    while (true) {
      const existing = await this.prisma.blogPost.findUnique({
        where: { slug },
      });

      if (!existing || (currentId && existing.id === currentId)) {
        return slug;
      }

      slug = `${baseSlug}-${counter}`;
      counter++;
    }
  }

  async createBlog(dto: CreateBlogDto) {
    const rawSlug = dto.slug ? this.generateSlug(dto.slug) : this.generateSlug(dto.title);
    const slug = await this.ensureUniqueSlug(rawSlug);

    const isPublished = dto.status === BlogStatus.PUBLISHED;
    const publishedAt = isPublished ? new Date() : null;

    return this.prisma.blogPost.create({
      data: {
        title: dto.title.trim(),
        slug,
        excerpt: dto.excerpt?.trim() || null,
        content: dto.content,
        coverImageUrl: dto.coverImageUrl?.trim() || null,
        category: dto.category?.trim() || 'Freelancing',
        tags: Array.isArray(dto.tags) ? dto.tags.map((t) => t.trim()).filter(Boolean) : [],
        authorName: dto.authorName?.trim() || 'Paklance Editorial Team',
        status: dto.status || BlogStatus.DRAFT,
        metaTitle: dto.metaTitle?.trim() || dto.title.trim(),
        metaDescription: dto.metaDescription?.trim() || dto.excerpt?.trim() || null,
        publishedAt,
      },
    });
  }

  async updateBlog(id: string, dto: UpdateBlogDto) {
    const existing = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Blog post with ID '${id}' not found`);
    }

    let slug = existing.slug;
    if (dto.slug && dto.slug !== existing.slug) {
      const rawSlug = this.generateSlug(dto.slug);
      slug = await this.ensureUniqueSlug(rawSlug, id);
    } else if (!dto.slug && dto.title && dto.title !== existing.title && !existing.slug) {
      slug = await this.ensureUniqueSlug(this.generateSlug(dto.title), id);
    }

    const data: any = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (slug !== existing.slug) data.slug = slug;
    if (dto.excerpt !== undefined) data.excerpt = dto.excerpt?.trim() || null;
    if (dto.content !== undefined) data.content = dto.content;
    if (dto.coverImageUrl !== undefined) data.coverImageUrl = dto.coverImageUrl?.trim() || null;
    if (dto.category !== undefined) data.category = dto.category?.trim() || 'Freelancing';
    if (dto.tags !== undefined) {
      data.tags = Array.isArray(dto.tags) ? dto.tags.map((t) => t.trim()).filter(Boolean) : [];
    }
    if (dto.authorName !== undefined) data.authorName = dto.authorName?.trim() || 'Paklance Editorial Team';
    if (dto.status !== undefined) {
      data.status = dto.status;
      if (dto.status === BlogStatus.PUBLISHED && !existing.publishedAt) {
        data.publishedAt = new Date();
      }
    }
    if (dto.metaTitle !== undefined) data.metaTitle = dto.metaTitle?.trim() || null;
    if (dto.metaDescription !== undefined) data.metaDescription = dto.metaDescription?.trim() || null;

    return this.prisma.blogPost.update({
      where: { id },
      data,
    });
  }

  async deleteBlog(id: string) {
    const existing = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Blog post with ID '${id}' not found`);
    }

    await this.prisma.blogPost.delete({ where: { id } });
    return { success: true, message: 'Blog post deleted successfully' };
  }

  async getBlogById(id: string) {
    const post = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!post) {
      throw new NotFoundException(`Blog post with ID '${id}' not found`);
    }
    return post;
  }

  async getBlogBySlug(slug: string, allowDraft = false) {
    const post = await this.prisma.blogPost.findUnique({ where: { slug } });
    if (!post) {
      throw new NotFoundException(`Blog post with slug '${slug}' not found`);
    }
    if (!allowDraft && post.status !== BlogStatus.PUBLISHED) {
      throw new NotFoundException(`Blog post is not published`);
    }
    return post;
  }

  async getAllBlogsForAdmin(query?: { status?: string; search?: string; category?: string }) {
    const where: any = {};
    if (query?.status && query.status !== 'ALL') {
      where.status = query.status as BlogStatus;
    }
    if (query?.category && query.category !== 'All') {
      where.category = query.category;
    }
    if (query?.search) {
      const q = query.search.trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { slug: { contains: q, mode: 'insensitive' } },
        { excerpt: { contains: q, mode: 'insensitive' } },
        { authorName: { contains: q, mode: 'insensitive' } },
      ];
    }

    return this.prisma.blogPost.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  async getPublishedBlogs(query?: { category?: string; search?: string; limit?: number; skip?: number }) {
    await this.seedInitialBlogsIfEmpty();

    const where: any = {
      status: BlogStatus.PUBLISHED,
    };

    if (query?.category && query.category !== 'All') {
      where.category = query.category;
    }
    if (query?.search) {
      const q = query.search.trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { excerpt: { contains: q, mode: 'insensitive' } },
        { content: { contains: q, mode: 'insensitive' } },
        { tags: { has: q } },
      ];
    }

    const [articles, total] = await Promise.all([
      this.prisma.blogPost.findMany({
        where,
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        take: query?.limit ? Number(query.limit) : 50,
        skip: query?.skip ? Number(query.skip) : 0,
      }),
      this.prisma.blogPost.count({ where }),
    ]);

    return { articles, total };
  }

  private async seedInitialBlogsIfEmpty() {
    try {
      const count = await this.prisma.blogPost.count();
      if (count > 0) return;

      this.logger.log('Seeding initial foundational blog posts into database...');

      const initialPosts = [
        {
          title: 'How to Build a High-Performing Remote Team',
          slug: 'how-to-build-a-high-performing-remote-team',
          category: 'Global Hiring',
          excerpt: 'Learn practical ways businesses can find, manage, and collaborate with top Pakistani talent across borders.',
          content: `<p>A remote team can be as effective as any office team, and sometimes more so. But it rarely happens by accident. High-performing remote teams are built on clear roles, good written communication and routines that everyone understands.</p><h2>Hire for communication as well as skill</h2><p>Technical ability matters, but in a remote team, how someone communicates matters just as much. During hiring, pay attention to how clearly candidates write, how they ask questions and how they explain their work.</p><ul><li>Review written answers, not only calls.</li><li>Ask candidates to explain a past project step by step.</li><li>Notice whether they confirm details or make assumptions.</li></ul><h2>Design the team’s working hours</h2><p>When people work across time zones, decide which hours are shared and which are for focused work. A few overlapping hours are usually enough for meetings and quick decisions.</p><h2>Give every task a clear owner</h2><p>In an office, it’s easy to lean over and ask who is handling something. Remotely, unclear ownership causes delays. Make sure every project, task and decision has one named owner.</p>`,
          coverImageUrl: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1200&q=80',
          tags: ['remote work', 'global hiring', 'pakistan talent', 'management'],
          authorName: 'Paklance Editorial Team',
          status: BlogStatus.PUBLISHED,
          metaTitle: 'How to Build a High-Performing Remote Team | Paklance Blog',
          metaDescription: 'Practical guide to hiring and managing remote teams with verified Pakistani talent on Paklance.',
          publishedAt: new Date('2026-09-24T10:00:00.000Z'),
        },
        {
          title: 'The Complete Guide to Paklance SafePay™ Escrow',
          slug: 'complete-guide-to-paklance-safepay-escrow',
          category: 'Finance & Payments',
          excerpt: 'How SafePay milestone protection safeguards clients and ensures guaranteed payouts for Pakistani specialists.',
          content: `<p>Trust is the bedrock of freelance work. Paklance SafePay™ ensures that clients only release funds when milestones are delivered to specification, and specialists work with 100% confidence that funds are secured upfront.</p><h2>How Milestone Funding Works</h2><p>When a contract begins, the client funds the first agreed milestone into SafePay escrow. The specialist receives immediate confirmation and begins work.</p><h2>Smooth Releases on Deliverables</h2><p>Once work is submitted and approved, funds are released immediately to the specialist's Paklance wallet, ready for withdrawal via local rails like Raast, NayaPay, SadaPay, or direct Bank Transfer.</p>`,
          coverImageUrl: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=1200&q=80',
          tags: ['safepay', 'escrow', 'payments', 'freelancing', 'pakistan'],
          authorName: 'Paklance Editorial Team',
          status: BlogStatus.PUBLISHED,
          metaTitle: 'Guide to Paklance SafePay Escrow | Paklance',
          metaDescription: 'Learn how SafePay escrow protects both clients and freelancers on Paklance.',
          publishedAt: new Date('2026-09-22T08:00:00.000Z'),
        },
      ];

      for (const post of initialPosts) {
        await this.prisma.blogPost.create({ data: post });
      }

      this.logger.log('Initial blog posts seeded successfully.');
    } catch (err: any) {
      this.logger.warn('Failed to seed initial blogs: ' + err?.message);
    }
  }
}
