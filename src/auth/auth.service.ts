import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Role, User } from 'src/user/entity/user.entity';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { envVariableKeys } from 'src/common/const/env.const';

@Injectable()
export class AuthService {
    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        private readonly configService: ConfigService,
        private readonly jwtService: JwtService,
    ){}

    parseBasicToken(rawToken: string){
        const basicSplit = rawToken.split(" ");
        if( basicSplit.length !== 2 ){
            throw new BadRequestException('토큰 포맷이 잘못됐습니다.');
        }

        const [basic, token] = basicSplit;
        if( basic.toLowerCase() !== 'basic') {
            throw new BadRequestException('토큰 포맷이 잘못됐습니다.');
        }

        const decoded = Buffer.from(token, 'base64').toString('utf-8');

        const tokenSplit = decoded.split(':');
        if( tokenSplit.length !== 2 ){
            throw new BadRequestException('토큰 포맷이 잘못됐습니다.');
        }

        const [email, password] = tokenSplit;
        return {email, password};
    }

    async register(rawToken: string){
        const {email, password} = this.parseBasicToken(rawToken);

        const user = await this.userRepository.findOne({
            where: {
                email
            }
        });
        if( user ){
            throw new BadRequestException('이미 가입한 이메일 입니다.');
        }

        const hash = await bcrypt.hash(password, this.configService.get<number>(envVariableKeys.HASH_ROUNDS))

        await this.userRepository.save({
            email,
            password: hash
        });

        return await this.userRepository.findOne({
            where: {
                email
            }
        });
    }

    async authenticate(email: string, password: string){
        const user = await this.userRepository.findOne({
            where: {
                email
            }
        });
        if( !user ){
            throw new BadRequestException('잘못된 로그인 정보입니다.');
        }

        const passOk = await bcrypt.compare(password, user.password);
        if(!passOk){
            throw new BadRequestException('잘못된 로그인 정보입니다.');
        }

        return user;
    }

    async issueToken(user: {id: number, role: Role}, isRefreshToken: boolean){
        const refreshTokenSecret = this.configService.get<string>(envVariableKeys.REFRESH_TOKEN_SECRET);
        const accressTokenSecret = this.configService.get<string>(envVariableKeys.REFRESH_TOKEN_SECRET);

        return await this.jwtService.signAsync({
            sub: user.id,
            role: user.role,
            type: isRefreshToken ? 'refresh' : 'access'
        }, {
            secret: isRefreshToken ? refreshTokenSecret : accressTokenSecret,
            expiresIn: isRefreshToken ? '24h' : 30000 // 300초 5분
        })
    }

    async login(rawToken: string){
        const {email, password} = this.parseBasicToken(rawToken);

        const user = await this.authenticate(email, password);

        return {
            refreshToken: await this.issueToken(user, true),
            accessToken: await this.issueToken(user, false),
        }
    }
}
