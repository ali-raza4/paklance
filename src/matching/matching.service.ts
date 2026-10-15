import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { calculateProfileCompletion } from '../profiles/profile-completion.util';

@Injectable()
export class MatchingService {
  constructor(private readonly prisma: PrismaService) {}

  private calculateScore(
    jobBudget: number,
    freelancerRate: number,
    jobSkills: string[],
    freelancerSkills: string[],
  ): number {
    const skillMatches = jobSkills.filter((s) =>
      freelancerSkills.some((fs) => fs.toLowerCase() === s.toLowerCase()),
    ).length;
    const skillScore =
      jobSkills.length > 0 ? (skillMatches / jobSkills.length) * 70 : 0;

    let rateScore = 0;
    if (freelancerRate > 0 && jobBudget > 0) {
      const diff = Math.abs(jobBudget - freelancerRate) / jobBudget;
      rateScore = Math.max(0, 30 - diff * 30);
    }

    return Math.round(skillScore + rateScore);
  }

  async findMatchesForJob(jobId: string, requiredSkills: string[] = []) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');

    const freelancers = await this.prisma.user.findMany({
      where: { role: 'SPECIALIST', availability: 'AVAILABLE', isDeleted: false },
      include: { portfolioItems: true },
    });

    const visibleFreelancers = freelancers.filter((f) => {
      const completion = calculateProfileCompletion(f);
      return completion.percentage > 50;
    });

    const scored = visibleFreelancers.map((f) => ({
      userId: f.id,
      headline: f.headline,
      skills: f.skills,
      hourlyRate: f.hourlyRate,
      score: this.calculateScore(
        Number(job.budget),
        Number(f.hourlyRate ?? 0),
        requiredSkills.length ? requiredSkills : [],
        f.skills,
      ),
    }));

    return scored.sort((a, b) => b.score - a.score).slice(0, 10);
  }

  async findMatchesForFreelancer(freelancerId: string) {
    const freelancer = await this.prisma.user.findUnique({
      where: { id: freelancerId },
    });
    if (!freelancer) throw new NotFoundException('Freelancer not found');

    const jobs = await this.prisma.job.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const scored = jobs.map((job) => ({
      jobId: job.id,
      title: job.title,
      budget: job.budget,
      score: this.calculateScore(
        Number(job.budget),
        Number(freelancer.hourlyRate ?? 0),
        [],
        freelancer.skills,
      ),
    }));

    return scored.sort((a, b) => b.score - a.score).slice(0, 10);
  }
}
