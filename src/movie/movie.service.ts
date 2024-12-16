import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateMovieDto } from './dto/create-movie.dto';
import { UpdateMovieDto } from './dto/update-movie.dto';
import { Movie } from './entity/movie.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Like, Repository } from 'typeorm';
import { MovieDetail } from './entity/movie-detail.entity';
import { Director } from 'src/director/entity/director.entity';
import { Genre } from 'src/genre/entity/genre.entity';

@Injectable()
export class MovieService {

  constructor(
    @InjectRepository(Movie)
    private readonly movieRepository: Repository<Movie>,
    @InjectRepository(MovieDetail)
    private readonly movieDetailRepository: Repository<MovieDetail>,
    @InjectRepository(Director)
    private readonly directorRepository: Repository<Director>,
    @InjectRepository(Genre)
    private readonly genreRepository: Repository<Genre>,
    private readonly dataSource: DataSource,
  ){}

  async findAll(title: string) {
    const qb = await this.movieRepository.createQueryBuilder('movie')
    .leftJoinAndSelect('movie.detail', 'detail')
    .leftJoinAndSelect('movie.director', 'director')
    .leftJoinAndSelect('movie.genres', 'genres');

    if(title){
      qb.where('movie.title LIKE :title', {title: `%${title}%`});
    }

    return qb.getManyAndCount();
  }

  async findOne(id: number) {
    const movie = await this.movieRepository.createQueryBuilder('movie')
    .leftJoinAndSelect('movie.detail', 'detail')
    .leftJoinAndSelect('movie.director', 'director')
    .leftJoinAndSelect('movie.genres', 'genres')
    .where('movie.id = :id', {id})
    .getOne();

    if(!movie) {
      throw new NotFoundException("존재하지 않는 ID 값의 영화입니다.");
    }

    return movie;
  }

  async create(createMovieDto: CreateMovieDto){
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      const director = await qr.manager.findOne(Director, {
        where: {
          id: createMovieDto.directorId
        }
      });
      if( !director ){
        throw new NotFoundException("존재하지 않는 감독 ID입니다.");
      }
  
      const genres = await qr.manager.find(Genre, {
        where: {
          id: In(createMovieDto.genreIds)
        }
      });
      if( genres.length !== createMovieDto.genreIds.length ){
        throw new NotFoundException(`존재하지 않는 장르가 있습니다. 존재하는 ids -> ${genres.map(genre => genre.id).join(',')}`);
      }
  
      const movieDetail = await qr.manager.createQueryBuilder()
      .insert()
      .into(MovieDetail)
      .values({
        description: createMovieDto.description
      })
      .execute();
      const movieDetailId: number = movieDetail.identifiers[0].id;

      const movie = await qr.manager.createQueryBuilder()
      .insert()
      .into(Movie)
      .values({
        title: createMovieDto.title,
        detail: {
          id: movieDetailId
        },
        director: director,
      })
      .execute();
      const movieId: number = movie.identifiers[0].id;

      await qr.manager.createQueryBuilder()
      .relation(Movie, 'genres')
      .of(movieId)
      .add(genres.map(genre => genre.id));

      await qr.commitTransaction();

      return this.movieRepository.findOne({
        where: {
          id: movieId
        },
        relations: ['detail', 'director', 'genres']
      });
    } catch (e) {      
      await qr.rollbackTransaction();
      throw e;
    } finally {
      await qr.release();
    }
  }

  async update(id: number, updateMovieDto: UpdateMovieDto) {
    const movie = await this.movieRepository.findOne({
      where: {id},
      relations: ['detail']
    });
    if(!movie) {
      throw new NotFoundException("존재하지 않는 ID 값의 영화입니다.");
    }

    const {description, directorId, genreIds, ...movieRest} = updateMovieDto;

    let newDirector;
    if( directorId ){
      const director = await this.directorRepository.findOne({
        where: {
          id: directorId
        }
      });
  
      if( !director ){
        throw new NotFoundException("존재하지 않는 감독 ID입니다.");
      }

      newDirector = director;
    }

    let newGenres;
    if(genreIds){
      const genres = await this.genreRepository.find({
        where: {
          id: In(updateMovieDto.genreIds)
        }
      });
      if( genres.length !== updateMovieDto.genreIds.length ){
        throw new NotFoundException(`존재하지 않는 장르가 있습니다. 존재하는 ids -> ${genres.map(genre => genre.id).join(',')}`);
      }

      newGenres = genres;
    }

    const moveUpdaetFields = {
      ...movieRest,
      ...(newDirector && { director: newDirector })
    };
    await this.movieRepository.update(
      {id},
      moveUpdaetFields,
    );

    if(description){
      await this.movieDetailRepository.update(
        {
          id: movie.detail.id
        },
        {
          description
        }
      );
    }

    const newMovie = await this.movieRepository.findOne({
      where: {id},
      relations: ['detail', 'director', 'genres']
    });

    newMovie.genres = newGenres;
    await this.movieRepository.save(newMovie);

    return this.movieRepository.findOne({
      where: {id},
      relations: ['detail', 'director', 'genres']
    });
  }

  async remove(id: number) {
    const movie = await this.movieRepository.findOne({
      where: {id},
      relations: ['detail']
    });
    if(!movie) {
      throw new NotFoundException("존재하지 않는 ID 값의 영화입니다.");
    }

    
    await this.movieRepository.delete(id);
    if(movie.detail) {
      await this.movieDetailRepository.delete(movie.detail.id);
    }

    return id;
  }
}
