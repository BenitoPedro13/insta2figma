import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() dto: RegisterDto): Promise<{
    accessToken: string;
    expiresIn: string;
    tokenType: 'Bearer';
  }> {
    return this.auth.register(dto).then((t) => ({
      ...t,
      tokenType: 'Bearer' as const,
    }));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<{
    accessToken: string;
    expiresIn: string;
    tokenType: 'Bearer';
  }> {
    return this.auth.login(dto).then((t) => ({
      ...t,
      tokenType: 'Bearer' as const,
    }));
  }
}
